require('dotenv').config()
const AmbientWeatherApi = require('ambient-weather-api')
const Wemo = require('wemo-client');
require('log-timestamp')(function() { return "[" + new Date().toLocaleDateString() +" "+ new Date().toLocaleTimeString() + "] %s"});

const JORDAN_HEATER_SERIAL = process.env.JORDAN_HEATER_SERIAL;
const AMBIENT_WEATHER_MAC_ADDRESS = process.env.AMBIENT_WEATHER_MAC_ADDRESS;
const AMBIENT_WEATHER_API_KEY = process.env.AMBIENT_WEATHER_API_KEY;
const AMBIENT_WEATHER_APPLICATION_KEY = process.env.AMBIENT_WEATHER_APPLICATION_KEY;
const DESIRED_TEMP = process.env.DESIRED_TEMP;


function toggleOn(wemoClient) {
    wemoClient.setBinaryState(1);
}

function toggleOff(wemoClient) {
    wemoClient.setBinaryState(0);
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



const api = new AmbientWeatherApi({
    apiKey: AMBIENT_WEATHER_API_KEY,
    applicationKey: AMBIENT_WEATHER_APPLICATION_KEY
});
function getName(device) {
    return device.info.name
}

function checkTempSetHeater() {
    // fetch the most recent data
    console.log('Fetching data...')
    api.deviceData(AMBIENT_WEATHER_MAC_ADDRESS, {
        limit: 1
    }).then((deviceData) => {
        deviceData.forEach((data) => {
            decideToTurnOnOrOff(data.date, data.tempinf)
        })
    }).catch((error) => {
        console.log("Error: "+ error)
    })
}

function decideToTurnOnOrOff(currentTempDateObserved, currentTemp) {
    if (currentTemp >= DESIRED_TEMP) {
        bedroomWemo.then((bedroomWemo) => {
            console.log("The temperature (%s˚F) is at or above the desired temperature (%s°F). Weather station timestamp: [%s°F].", currentTemp, DESIRED_TEMP, currentTempDateObserved);
            toggleOff(bedroomWemo);
        });
    } else {
        bedroomWemo.then((bedroomWemo) => {
            console.log("The temperature (%s˚F) is below the desired temperature (%s°F). Weather station timestamp: [%s°F].", currentTemp, DESIRED_TEMP, currentTempDateObserved);
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
    

    checkTempSetHeater();
    setInterval(()=> { checkTempSetHeater() }, 300000);
    
    subscribeToAmbientWeather();
}


function subscribeToAmbientWeather() {
    api.on("connect", () => {
        console.log("Connected to Ambient Weather Realtime API!");
        api.subscribe(AMBIENT_WEATHER_API_KEY);
    });

    api.on("subscribed", data => {
        console.log("Subscribed to " + data.devices.length + " device(s): ");
        console.log(data.devices.map(getName).join(", "));
        console.log("Listening for temperature updates...");
    });

    api.on("unsubscribed", data => {
        console.log("Unsubscribed from " + data.devices.length + " device(s): ");
        console.log(data.devices.map(getName).join(", "));
    });

    api.on("data", data => {
        decideToTurnOnOrOff(data.date, data.tempinf);
        console.log("Received data: "+ data.date + " - " + " current indoor temperature is: " + data.tempinf + "°F");
    })

    api.connect();
}

main();
