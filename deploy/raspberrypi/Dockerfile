FROM resin/raspberrypi-node:latest

RUN apt-get update && \
    apt-get install -y unzip && \
    apt-get install -y curl

ADD https://github.com/HackerLoop/rotonde-ip9258/archive/master.zip /tmp/master.zip
RUN unzip /tmp/master.zip -d /usr/local/ && mv /usr/local/rotonde-ip9258-master /usr/local/rotonde-ip9258

WORKDIR "/usr/local/rotonde-ip9258/"

RUN npm install

RUN apt-get autoremove -y unzip curl && \
    apt-get purge

CMD ["/usr/local/bin/node", "index.js"]
