pipeline {
    agent any;

    environment {
        AWS_ACCESS_KEY_ID     = credentials('aws_access_key')
        AWS_SECRET_ACCESS_KEY = credentials('aws_secrat_key')
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
