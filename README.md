## Prerequities

1. Docker
2. AWS Account

### Setup Jenkins 

1. Create `touch ./Dockerfile` copy and paste the following in the `./Dockerfile`
```Dockerfile

FROM jenkins/jenkins:lts

USER root
RUN apt-get update \
    && apt-get clean \
    && apt install awscli -y

USER jenkins

```

2. Run the following command to run jenkins on your pc 
```bash
mkdir -p jenkinsdata
docker build -t jenkins-lts .
docker run -p 8080:8080 -v "$(pwd)/jenkinsdata:/var/jenkins_home" jenkins-lts
```

3. Now let's setup our infrastructure create `./main.yaml` file
- Let's setup our bucket copy and paste following to create a bucket in `main.yaml`
```yaml
AWSTemplateFormatVersion: '2010-09-09'
Description: Static website hosting with S3, Lambda, and API Gateway with CORS support.

Resources:
  WebsiteBucket:
    Type: AWS::S3::Bucket
    Properties:
      AccessControl: LogDeliveryWrite
      VersioningConfiguration:
        Status: Enabled
      WebsiteConfiguration:
        IndexDocument: 'index.html'
        ErrorDocument: 'error.html'
      BucketEncryption:
        ServerSideEncryptionConfiguration:
          - ServerSideEncryptionByDefault:
              SSEAlgorithm: AES256
      OwnershipControls:
        Rules:
          - ObjectOwnership: ObjectWriter
    
```

- Now To create DynamoDB table copy and paste the following in `main.yaml`
```yaml
  DataTable:
    Type: AWS::DynamoDB::Table
    Properties:
      TableName: !Sub "${AWS::StackName}-DataTable"
      AttributeDefinitions:
        - AttributeName: id
          AttributeType: S
      KeySchema:
        - AttributeName: id
          KeyType: HASH
      BillingMode: PAY_PER_REQUEST
```

- To give permission for lambda we create a lambda role and give it permissions for invoking function. api gateway and dynanmodb 
```yaml
 LambdaExecutionRole:
    Type: AWS::IAM::Role
    Properties:
      AssumeRolePolicyDocument:
        Version: "2012-10-17"
        Statement:
          - Effect: "Allow"
            Principal:
              Service:
                - "lambda.amazonaws.com"
            Action:
              - "sts:AssumeRole"
      ManagedPolicyArns:
        - arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
      Policies:
        - PolicyName: "S3AndDynamoDBAccessPolicy"
          PolicyDocument:
            Version: "2012-10-17"
            Statement:
              - Effect: "Allow"
                Action:
                  - "s3:PutObject"
                  - "dynamodb:PutItem"
                  - "lambda:*"
                  - "apigateway:*"
                  - "logs:*"
                  - "cloudwatch:*"
                Resource: 
                  -  "*"
```
 
- To create a lambda function copy and paste the following
```yaml

  DataMessageLambdaFunction:
    Type: AWS::Lambda::Function
    Properties:
      Handler: index.lambda_handler
      Role: !GetAtt LambdaExecutionRole.Arn
      Code:
        ZipFile: |
          import json
          import boto3
          import os

          
          dynamodb = boto3.resource('dynamodb')
          data_table = os.environ['DATA_TABLE']

          def lambda_handler(event, context):
              try:
                  if 'body' not in event or 'data' not in json.loads(event['body']):
                      raise ValueError('Invalid event structure')

                  data = json.loads(event['body'])['data']
                  object_key = f"logs/{context.aws_request_id}.txt"

                  

                  table = dynamodb.Table(data_table)
                  table.put_item(
                      Item={
                          'id': object_key,
                          'data': data
                      }
                  )

                  return {
                      'statusCode': 200,
                      'body': json.dumps('Data logged successfully.'),
                      'headers': {
                          'Access-Control-Allow-Origin': '*',
                          'Access-Control-Allow-Headers': 'Content-Type',
                          'Access-Control-Allow-Methods': 'OPTIONS,POST'
                      }
                  }

              except Exception as e:
                  return {
                      'statusCode': 500,
                      'body': json.dumps(f'Error: {str(e)}'),
                      'headers': {
                          'Access-Control-Allow-Origin': '*',
                          'Access-Control-Allow-Headers': 'Content-Type',
                          'Access-Control-Allow-Methods': 'OPTIONS,POST'
                      }
                  }
      Runtime: python3.11
      Environment:
        Variables:
          DATA_TABLE: !Ref DataTable

```

- Let's create a api gateway trigger for lambda function
```yaml

  ApiGatewayRestApi:
    Type: AWS::ApiGateway::RestApi
    Properties:
      Name: !Sub "${AWS::StackName}-DataLoggingAPI"

  ApiGatewayResource:
    Type: AWS::ApiGateway::Resource
    Properties:
      ParentId: !GetAtt ApiGatewayRestApi.RootResourceId
      PathPart: logdata
      RestApiId: !Ref ApiGatewayRestApi

  ApiGatewayMethodPost:
    Type: AWS::ApiGateway::Method
    Properties:
      AuthorizationType: NONE
      HttpMethod: POST
      ResourceId: !Ref ApiGatewayResource
      RestApiId: !Ref ApiGatewayRestApi
      Integration:
        IntegrationHttpMethod: POST
        Type: AWS_PROXY
        Uri: !Sub
          - arn:aws:apigateway:${AWS::Region}:lambda:path/2015-03-31/functions/${LambdaArn}/invocations
          - LambdaArn: !GetAtt DataMessageLambdaFunction.Arn

  ApiGatewayMethodOptions:
    Type: AWS::ApiGateway::Method
    Properties:
      AuthorizationType: NONE
      HttpMethod: OPTIONS
      ResourceId: !Ref ApiGatewayResource
      RestApiId: !Ref ApiGatewayRestApi
      Integration:
        IntegrationResponses:
          - StatusCode: 200
            ResponseParameters:
              method.response.header.Access-Control-Allow-Headers: "'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token'"
              method.response.header.Access-Control-Allow-Methods: "'GET,POST,OPTIONS'"
              method.response.header.Access-Control-Allow-Origin: "'*'"
        PassthroughBehavior: WHEN_NO_MATCH
        RequestTemplates:
          application/json: '{"statusCode": 200}'
        Type: MOCK
      MethodResponses:
        - StatusCode: 200
          ResponseParameters:
            method.response.header.Access-Control-Allow-Headers: true
            method.response.header.Access-Control-Allow-Methods: true
            method.response.header.Access-Control-Allow-Origin: true
          ResponseModels:
            application/json: 'Empty'

  ApiGatewayDeployment:
    Type: 'AWS::ApiGateway::Deployment'
    DependsOn:
      - ApiGatewayMethodPost
      - ApiGatewayMethodOptions
    Properties:
      RestApiId: !Ref ApiGatewayRestApi
      StageName: prod

  LambdaApiGatewayPermission:
    Type: AWS::Lambda::Permission
    Properties:
      Action: lambda:InvokeFunction
      FunctionName: !Ref DataMessageLambdaFunction
      Principal: apigateway.amazonaws.com
      SourceArn: !Sub "arn:aws:execute-api:${AWS::Region}:${AWS::AccountId}:${ApiGatewayRestApi}/*/POST/logdata"

```

- Create a log group for it copy and paste to `./main.yaml`
```yaml

  LogBucket:
    Type: AWS::S3::Bucket
    Properties:
      AccessControl: LogDeliveryWrite
      VersioningConfiguration:
        Status: Enabled
      BucketEncryption:
        ServerSideEncryptionConfiguration:
          - ServerSideEncryptionByDefault:
              SSEAlgorithm: AES256
      OwnershipControls:
        Rules:
          - ObjectOwnership: ObjectWriter

  LambdaLogGroup:
    Type: AWS::Logs::LogGroup
    Properties:
      LogGroupName: !Sub "/aws/lambda/${DataMessageLambdaFunction}"
      RetentionInDays: 7

  CloudFrontOriginAccessIdentity:
    Type: AWS::CloudFront::CloudFrontOriginAccessIdentity
    Properties:
      CloudFrontOriginAccessIdentityConfig:
        Comment: !Sub "OAI for ${AWS::StackName}"

```

- Create CLoudfornt Distribution on it
```yaml

  CloudFrontDistribution:
    Type: AWS::CloudFront::Distribution
    Properties:
      DistributionConfig:
        Enabled: true
        Origins:
          - Id: S3Origin
            DomainName: !GetAtt WebsiteBucket.RegionalDomainName
            S3OriginConfig:
              OriginAccessIdentity: !Sub "origin-access-identity/cloudfront/${CloudFrontOriginAccessIdentity}"
        DefaultCacheBehavior:
          TargetOriginId: S3Origin
          ViewerProtocolPolicy: allow-all
          AllowedMethods:
            - HEAD
            - DELETE
            - POST
            - GET
            - OPTIONS
            - PUT
            - PATCH
          ForwardedValues:
            QueryString: false
            Cookies:
              Forward: none
          Compress: true
        IPV6Enabled: true
        DefaultRootObject: index.html
        HttpVersion: http2
        Logging:
          Bucket: !GetAtt LogBucket.DomainName
          Prefix: cloudfront/
      Tags:
        - Key: Name
          Value: !Sub "${AWS::StackName}-CloudFrontDistribution"

```

- Create a WebACL for it copy and paste to `./main.yaml`
```yaml

  WebACL:
    Type: AWS::WAFv2::WebACL
    Properties:
      Name: !Sub "${AWS::StackName}-WebACL"
      Scope: CLOUDFRONT
      DefaultAction:
        Allow: {}
      VisibilityConfig:
        CloudWatchMetricsEnabled: true
        MetricName: !Sub "${AWS::StackName}-WebACL"
        SampledRequestsEnabled: true
      Rules:
        - Name: LimitRequests100
          Priority: 1
          Action:
            Block: {}
          VisibilityConfig:
            CloudWatchMetricsEnabled: true
            MetricName: !Sub "${AWS::StackName}-LimitRequests100"
            SampledRequestsEnabled: true
          Statement:
            RateBasedStatement:
              AggregateKeyType: IP
              Limit: 100

```

- Create Output for it copy and paste to `./main.yaml`

```yaml
Outputs:
  WebsiteURL:
    Value: !GetAtt WebsiteBucket.WebsiteURL
    Description: URL of the static website
  ApiEndpoint:
    Value: !Sub "https://${ApiGatewayRestApi}.execute-api.${AWS::Region}.amazonaws.com/prod/logdata"
    Description: API Gateway endpoint for logging data
  BucketName:
    Value: !Ref WebsiteBucket
    Description: Name of the sample Amazon S3 bucket with a lifecycle configuration
  CloudFrontDistributionDomainName:
    Value: !GetAtt CloudFrontDistribution.DomainName
    Description: Domain name of the CloudFront distribution
  WebsiteBucketname: 
    Value: !Ref WebsiteBucket
    Description: Name of the sample Amazon S3 bucket with a lifecycle configuration
```

- Create a `./index.html` for our website template
```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Animated Data Streaming Dashboard</title>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <link rel="stylesheet" href="style.css">
</head>
<body>
    <div class="background-animation"></div>
    
    <header>
        <h1 class="animated-text">Data Streaming Dashboard</h1>
    </header>
    
    <main>
        <section id="data-form" class="animated-section card">
            <h2 class="section-title"><i class="fas fa-pencil-alt"></i> Input Data</h2>
            <form id="streaming-form">
                <div class="input-group">
                    <input type="text" id="data-input" name="data-input" required>
                    <label for="data-input">Enter data</label>
                    <span class="input-highlight"></span>
                </div>
                <button type="submit" class="submit-btn">
                    <span>Submit</span>
                    <i class="fas fa-paper-plane"></i>
                </button>
            </form>
        </section>

        <section id="data-display" class="animated-section card">
            <h2 class="section-title"><i class="fas fa-stream"></i> Data Stream</h2>
            <div id="stream-container"></div>
        </section>

        <section id="not-found" class="animated-section card">
            <div id="title" class="animated-text">404 Error</div>
            <div class="circles">
              <p>404<br>
               <small>PAGE NOT FOUND</small>
              </p>
              <span class="circle big"></span>
              <span class="circle med"></span>
              <span class="circle small"></span>
            </div>
        </section>
    </main>

    <footer>
        <p class="animated-text">&copy; 2024 Data Streaming Dashboard</p>
    </footer>

    <script src="script.js"></script>
</body>
</html>

```

- Create a `./style.css`  file for styling website copy and paste the following in it
```css
@import url('https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;600&display=swap');

:root {
    --primary-color: #6c5ce7;
    --secondary-color: #a29bfe;
    --background-color: #dfe6e9;
    --text-color: #2d3436;
    --card-background: rgba(255, 255, 255, 0.9);
    --animation-speed: 0.3s;
}

* {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
}

body {
    font-family: 'Poppins', sans-serif;
    background-color: var(--background-color);
    color: var(--text-color);
    line-height: 1.6;
    overflow-x: hidden;
}

.background-animation {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    z-index: -1;
    background: linear-gradient(45deg, var(--primary-color), var(--secondary-color));
    opacity: 0.1;
    animation: gradientAnimation 15s ease infinite;
}

@keyframes gradientAnimation {
    0% { background-position: 0% 50%; }
    50% { background-position: 100% 50%; }
    100% { background-position: 0% 50%; }
}

header, footer {
    background-color: var(--primary-color);
    color: white;
    text-align: center;
    padding: 1rem;
    position: relative;
    z-index: 10;
}

main {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 2rem;
    min-height: calc(100vh - 120px);
}

.card {
    background-color: var(--card-background);
    border-radius: 15px;
    box-shadow: 0 10px 20px rgba(0, 0, 0, 0.1);
    padding: 2rem;
    margin-bottom: 2rem;
    width: 90%;
    max-width: 600px;
    transition: transform var(--animation-speed) ease, box-shadow var(--animation-speed) ease;
}

.card:hover {
    transform: translateY(-5px);
    box-shadow: 0 15px 30px rgba(0, 0, 0, 0.15);
}

.section-title {
    color: var(--primary-color);
    margin-bottom: 1.5rem;
    font-weight: 600;
    display: flex;
    align-items: center;
}

.section-title i {
    margin-right: 0.5rem;
    font-size: 1.2em;
}

.animated-section {
    opacity: 0;
    transform: translateY(20px);
    transition: opacity 0.5s ease, transform 0.5s ease;
}

.animated-section.visible {
    opacity: 1;
    transform: translateY(0);
}

.animated-text {
    display: inline-block;
    transition: color var(--animation-speed) ease, transform var(--animation-speed) ease;
}

.animated-text:hover {
    color: var(--secondary-color);
    transform: scale(1.05);
}

form {
    display: flex;
    flex-direction: column;
}

.input-group {
    position: relative;
    margin-bottom: 1.5rem;
}

.input-group input {
    width: 100%;
    padding: 10px;
    border: none;
    border-bottom: 2px solid var(--primary-color);
    background-color: transparent;
    outline: none;
    font-size: 1rem;
    transition: border-color var(--animation-speed) ease;
}

.input-group label {
    position: absolute;
    top: 10px;
    left: 0;
    color: var(--text-color);
    font-size: 1rem;
    transition: all var(--animation-speed) ease;
    pointer-events: none;
}

.input-group input:focus ~ label,
.input-group input:valid ~ label {
    top: -20px;
    font-size: 0.8rem;
    color: var(--primary-color);
}

.input-highlight {
    position: absolute;
    bottom: 0;
    left: 0;
    height: 2px;
    width: 0;
    background-color: var(--secondary-color);
    transition: width var(--animation-speed) ease;
}

.input-group input:focus ~ .input-highlight {
    width: 100%;
}

.submit-btn {
    background-color: var(--primary-color);
    color: white;
    border: none;
    padding: 10px 20px;
    border-radius: 25px;
    cursor: pointer;
    font-size: 1rem;
    transition: background-color var(--animation-speed) ease, transform var(--animation-speed) ease;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
}

.submit-btn span {
    display: inline-block;
    transition: transform var(--animation-speed) ease;
}

.submit-btn i {
    margin-left: 10px;
    transform: translateX(30px);
    opacity: 0;
    transition: transform var(--animation-speed) ease, opacity var(--animation-speed) ease;
}

.submit-btn:hover {
    background-color: var(--secondary-color);
    transform: scale(1.05);
}

.submit-btn:hover span {
    transform: translateX(-15px);
}

.submit-btn:hover i {
    transform: translateX(0);
    opacity: 1;
}

#stream-container {
    height: 200px;
    overflow-y: auto;
    border: 1px solid var(--secondary-color);
    border-radius: 10px;
    padding: 1rem;
}

#stream-container::-webkit-scrollbar {
    width: 8px;
}

#stream-container::-webkit-scrollbar-track {
    background: #f1f1f1;
    border-radius: 10px;
}

#stream-container::-webkit-scrollbar-thumb {
    background: var(--secondary-color);
    border-radius: 10px;
}

#stream-container div {
    margin-bottom: 0.5rem;
    padding: 0.5rem;
    background: rgba(108, 92, 231, 0.1);
    border-radius: 5px;
    transition: background var(--animation-speed) ease, transform var(--animation-speed) ease;
}

#stream-container div:hover {
    background: rgba(108, 92, 231, 0.2);
    transform: translateX(5px);
}

#not-found {
    text-align: center;
}

#title {
    font-size: 2.5rem;
    margin-bottom: 1rem;
    color: var(--primary-color);
}

.circles {
    position: relative;
    height: 300px;
    width: 100%;
    max-width: 400px;
    margin: 0 auto;
    overflow: hidden;
}

.circles p {
    font-size: 6rem;
    color: var(--primary-color);
    position: relative;
    z-index: 9;
    line-height: 1;
    text-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.circles p small {
    font-size: 1.5rem;
    display: block;
    margin-top: 0.5rem;
}

.circles .circle {
    border-radius: 50%;
    background: var(--secondary-color);
    position: absolute;
    z-index: 1;
    transition: background var(--animation-speed) ease, transform var(--animation-speed) ease;
}

.circles:hover .circle {
    background: var(--primary-color);
    transform: scale(1.1);
}

.circles .circle.small {
    width: 100px;
    height: 100px;
    top: 60px;
    left: 50%;
    animation: 7s smallmove infinite cubic-bezier(1,.22,.71,.98);
}

.circles .circle.med {
    width: 150px;
    height: 150px;
    top: -10px;
    left: 10%;
    animation: 7s medmove infinite cubic-bezier(.32,.04,.15,.75);
}

.circles .circle.big {
    width: 300px;
    height: 300px;
    top: 150px;
    right: -50px;
    animation: 8s bigmove infinite cubic-bezier(.32,.04,.15,.75);
}

@keyframes smallmove {
    0% { top: 60px; left: 50%; opacity: 1; }
    25% { top: 220px; left: 40%; opacity:0.7; }
    50% { top: 180px; left: 55%; opacity:0.4; }
    75% { top: 80px; left: 45%;  opacity:0.6; }
    100% { top: 60px; left: 50%; opacity: 1; }
}

@keyframes medmove {
    0% { top: -10px; left: 20%; opacity: 1; }
    25% { top: 200px; left: 80%; opacity:0.7; }
    50% { top: 170px; left: 55%; opacity:0.4; }
    75% { top: 50px; left: 40%;  opacity:0.6; }
    100% { top: -10px; left: 20%; opacity: 1; }
}

@keyframes bigmove {
    0% { top: 150px; right: -50px; opacity: 0.5; }
    25% { top: 80px; right: 40px; opacity:0.4; }
    50% { top: 200px; right: 45px; opacity:0.8; }
    75% { top: 100px; right: 35px;  opacity:0.6; }
    100% { top: 150px; right: -50px; opacity: 0.5; }
}
```
- Create a `./script.js` file and copy and paste the following 
```js
document.addEventListener('DOMContentLoaded', function() {
    const form = document.getElementById('streaming-form');
    const input = document.getElementById('data-input');
    const streamContainer = document.getElementById('stream-container');

    // Replace this URL with your actual API Gateway endpoint
    // const apiUrl = 'https://i7wa804np9.execute-api.us-east-1.amazonaws.com/prod/logdata';

    // Animate sections on scroll
    const animatedSections = document.querySelectorAll('.animated-section');
    const observerOptions = {
        root: null,
        rootMargin: '0px',
        threshold: 0.1
    };

    const observer = new IntersectionObserver((entries, observer) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('visible');
                observer.unobserve(entry.target);
            }
        });
    }, observerOptions);

    animatedSections.forEach(section => {
        observer.observe(section);
    });

    // Form submission and data streaming
    form.addEventListener('submit', function(e) {
        e.preventDefault();
        
        const data = input.value.trim();
        if (data) {
            sendDataToApi(data);
            input.value = '';
            animateButton();
        }
    });

    async function sendDataToApi(data) {
        try {
            const response = await fetch(apiUrl, {
                method: 'POST',
                mode: 'no-cors',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ data: data }),
            });

            // Check if the response is OK (status code 200-299)
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            // If the response is JSON, parse it; otherwise, get the text
            const result = await response.text();

            console.log('Success:', result);
            addToStream(`Data stored successfully: ${data}`);
        } catch (error) {
            console.error('Error:', error);
            addToStream(`Error sending data: ${data}`);
        }
    }

    function addToStream(data) {
        const item = document.createElement('div');
        item.textContent = `${new Date().toLocaleTimeString()}: ${data}`;
        item.style.opacity = '0';
        item.style.transform = 'translateX(-20px)';
        streamContainer.prepend(item);

        // Animate the new item
        setTimeout(() => {
            item.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
            item.style.opacity = '1';
            item.style.transform = 'translateX(0)';
        }, 10);

        // Keep only the last 10 items
        while (streamContainer.children.length > 10) {
            streamContainer.removeChild(streamContainer.lastChild);
        }
    }

    function animateButton() {
        const button = form.querySelector('button');
        button.classList.add('animate');
        setTimeout(() => {
            button.classList.remove('animate');
        }, 500);
    }
});
```
- Now let's create a `./Jenkinsfile` for deploying pipeline
```groovy
pipeline {
    agent any;

    environment {
        AWS_ACCESS_KEY_ID     = credentials('aws_access_key')
        AWS_SECRET_ACCESS_KEY = credentials('aws_secret_key')
        REGION = 'us-east-1'
    }

    stages {
        stage('AWS Configure') {
            steps {
                sh "aws configure set aws_access_key_id $AWS_ACCESS_KEY_ID"
                sh "aws configure set aws_secret_access_key $AWS_SECRET_ACCESS_KEY"
                sh "aws configure set region $REGION"
            }
        }

        stage('CloudFormation Deploy') {
            steps {
                sh """
                aws cloudformation create-stack \
                 --stack-name web_chat \
                 --template-body file://main.yaml \
                 --capabilities CAPABILITY_IAM
                """
                // Wait for the stack to be created
                sh "aws cloudformation wait stack-create-complete --stack-name web_chat"
            }
        }

        stage('Get Outputs') {
            steps {
                script {
                    def stackOutputs = sh(
                        script: "aws cloudformation describe-stacks --stack-name web_chat --query 'Stacks[0].Outputs' --output json",
                        returnStdout: true
                    ).trim()
                    
                    def outputs = readJSON(text: stackOutputs)
                    env.WEBSITE_BUCKET_NAME = outputs.find { it.OutputKey == 'WebsiteBucketname' }.OutputValue
                    env.API_ENDPOINT = outputs.find { it.OutputKey == 'ApiEndpoint' }.OutputValue
                }
            }
        }

        stage('Update Script with API Endpoint') {
            steps {
                sh """
                awk -v api_url="${API_ENDPOINT}" 'BEGIN { print "const api_url = \"" api_url "\";" } { print }' script.js > temp.js && mv temp.js script.js
                """
            }
        }

        stage('Sync Static Code to S3') {
            steps {
                sh """
                aws s3 sync index.html s3://$WEBSITE_BUCKET_NAME
                aws s3 sync script.js s3://$WEBSITE_BUCKET_NAME
                aws s3 sync style.css s3://$WEBSITE_BUCKET_NAME
                """
            }
        }
    }
}
```
 
# Now let's create a secret in Jenkins

- Go to Jenkins Dashboard
- Click on **Manage Jenkins** 
- Under **Credentials** click on **System**
- Click on **Global credentials (unrestricted)**
- Click on **+ Add Credentials**
- Kind **Secret Text** in **secret** paste your aws access key `AKIAXXXXXXXX` give it a **Id** like `aws_access_key`  then **Description** like `access key for aws` click **Create**
- Again create a `aws_secret_key` with Kind **Secret Text** in **secret** paste your aws access key `SECRETKEY` give it a **Id** like `aws_secret_key`  then **Description** like `secret key for aws` click **Create** .

# Jenkins pipeline

Now push the codes to github

```bash
git add .
git commit -m "added a file"
git push
```

## **Create a Pipeline Job**



- From Jenkins' **dashboard**, click New Item and create a **Pipeline Job.**
- Under **Build Triggers**, choose Trigger builds remotely. You must set a unique, secret token for this field.(Optional)
- Under **Pipeline**, make sure the parameters are set as follows:
- **Definition: Pipeline script from SCM**
- **SCM**: Configure your SCM. Make sure to only build your main branch. For example, if your main branch is called **"master"**, put **"*/main"** under Branches to build.
- Script Path: Jenkinsfile
- Click **Save**.

## Click on `Builld Now` wait until pipeline become success
