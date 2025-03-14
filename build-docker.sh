#!/bin/bash
docker login
docker build -t xkstatus .
docker tag xkstatus:0.1 xiaokw/xkstatus
docker push xiaokw/xkstatus
