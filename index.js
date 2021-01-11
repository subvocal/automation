#!/usr/bin/env node"
"use strict";

require('dotenv').config();
const Wemo = require('wemo-client');
const MQTT = require('mqtt');
const promClient = require('prom-client');
const http = require('http')
const url = require('url')
require('log-timestamp')(function() { return "[" + new Date().toLocaleDateString() +" "+ new Date().toLocaleTimeString() + "] %s"});

const JORDAN_HEATER_SERIAL = process.env.JORDAN_HEATER_SERIAL;
const DESIRED_TEMP = process.env.DESIRED_TEMP;

const MQTT_HOST = process.env.MQTT_HOST;
const MQTT_USERNAME = process.env.MQTT_USERNAME;
const MQTT_PASSWORD = process.env.MQTT_PASSWORD;
const MQTT_TOPIC = process.env.MQTT_TOPIC;


const client = MQTT.connect(MQTT_HOST, {username: MQTT_USERNAME, password:MQTT_PASSWORD});
console.log("Connecting to MQTT host: %s", MQTT_HOST);


/* Setup Metrics Collection */
// Create a Registry which registers the metrics
const register = new promClient.Registry();
// Add a default label which is added to all metrics
register.setDefaultLabels({
    service: 'automation'
});
// Enable the collection of default metrics
promClient.collectDefaultMetrics({ register })

// Metrics
const tempGuage = new promClient.Gauge({ name: "temperature", help: "Temperature in F˚", labelNames: ["room"], registers: [register] });
const desiredTempGuage = new promClient.Gauge({ name: "desired_temperature", help: "The desired temperature in F˚", labelNames: ["room"], registers: [register] });
const wemoStateGuage = new promClient.Gauge({ name: "wemo_state", help: "On/Off state for Wemo", labelNames: ["room"], registers: [register] });

// Define the HTTP server
const server = http.createServer( (req, res) => {
    const route = url.parse(req.url).pathname.toString();
    if (route === '/metrics') {
        // Return all metrics the Prometheus exposition format
        res.setHeader('Content-Type', register.contentType)
        register.metrics().then( (metricResponse) => {
            res.end(metricResponse);
        }).catch( (error) => {
            console.log("Error generating metrics: %s", error)
            res.end();
        });
      } else {
          res.writeHead(404);
          res.end("404 Not Found");
      }
  });
// Start the HTTP server which exposes the metrics on http://localhost:3500/metrics
server.listen(3500);
console.log("Serving metrics on http://localhost:3500/metrics");



function toggleOn(wemoClient) {
    wemoClient.setBinaryState(1);
    wemoStateGuage.set({room: "jordan"}, 1);
}

function toggleOff(wemoClient) {
    wemoClient.setBinaryState(0);
    wemoStateGuage.set({room: "jordan"}, 0);
}

const bedroomWemo = new Promise((resolve, reject) => {
    let wemo = new Wemo();
    wemo.discover(function (err, device) {
        //console.log('Wemo Device Found: %j', device);

        if (device.serialNumber == JORDAN_HEATER_SERIAL) {
            console.log("Found the %s Switch.", device.friendlyName);
            resolve(wemo.client(device));
        } else {
            console.log("Can't find the Wemo Switch.");
            reject("FAILURE FINDING WEMO SWITCH!");
        }
    });
});



function decideToTurnOnOrOff(currentTempDateObserved, currentTemp) {
    desiredTempGuage.set({room: "jordan"}, parseInt(DESIRED_TEMP));
    tempGuage.set({room: "jordan"}, currentTemp);

    if (currentTemp >= DESIRED_TEMP) {
        bedroomWemo.then((bedroomWemo) => {
            console.log("The temperature (%s˚F) is at or above the desired temperature (%s°F). Weather station timestamp: [%s].", currentTemp, DESIRED_TEMP, currentTempDateObserved);
            toggleOff(bedroomWemo);
        });
    } else {
        bedroomWemo.then((bedroomWemo) => {
            console.log("The temperature (%s˚F) is below the desired temperature (%s°F). Weather station timestamp: [%s].", currentTemp, DESIRED_TEMP, currentTempDateObserved);
            toggleOn(bedroomWemo);
        });
    }
}

function main() {
    bedroomWemo.then((weemoDevice) => {
        weemoDevice.on('binaryState', function (value) {            
            let state = (value === "1") ? "on" : "off";
            console.log('Switch %s is %s', this.device.friendlyName, state);
        });
    });
    
    subscribeAndHandleUpdates();
}


function subscribeAndHandleUpdates() {
    client.on("connect", () => {
        client.subscribe(MQTT_TOPIC);
        console.log("Successfully connected to MQTT host: %s and subscribed to topic %s", MQTT_HOST, MQTT_TOPIC);
    });
    
    client.on("message", (topic, message) => {
        console.log("Received message from MQTT: %s", message.toString());

        let latestReading = JSON.parse(message);
        decideToTurnOnOrOff(latestReading.time, latestReading.temperature_F);

    });

    client.on("error", (error) => {
        console.log("Error connecting to the MQTT service.");
    });
    client.on("reconnect", (error) => {
        console.log("Attempting to reconnected to the MQTT service.");
    });
    client.on("close", (error) => {
        console.log("MQTT service connection was closed.");
    });
    client.on("disconnect", (error) => {
        console.log("MQTT service was disconnected.");
    });
    client.on("offline", (error) => {
        console.log("MQTT client is offline.");
    });
}


main();
