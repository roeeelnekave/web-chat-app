
FROM jenkins/jenkins:lts

USER root
RUN apt-get update \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* \
    && apt install awscli -y

USER jenkins


