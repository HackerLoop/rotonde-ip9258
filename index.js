'use strict';

const _ = require('lodash');
const fs = require("fs");

var fetch = require('node-fetch');

const client = new require('rotonde-client/node/rotonde-client')('ws://rotonde:4224');

const exec = require('child_process').exec;

// Looks for power plugs by ARP scanning, require sudo apt-get install -y arp-scan
const findByArp = () => {
	exec('arp-scan -lgR', (error, stdout, stderr) => {
		if (stderr) {
			console.log(stderr);
			return;
		}
		const lines = _.filter(stdout.split('\n'), (line) => /00:92:58:01/.test(line));
		const machines = _.map(lines, (line) => {
			const attrs = line.split('\t');
			const plug = plugs[attrs[1]];

			if (plug) {
				console.log('Got: ', plug, ' ', attrs);
				plug.ip = attrs[0];
				updatePlugOutlets(plug);
			}

		});
		setTimeout(findByArp, 3 * 60 * 1000); // every 3 min
	});
};
findByArp();

const cmdUrl = (plug, cmd, params, order) => {
  const paramsUrl = _.reduce(order || _.keys(params), (v, param) => {
    return v + '+' + param + '=' + params[param];
  }, '');
  return 'http://' + plug.ip + '/set.cmd?user=' + plug.login + '+pass=' + plug.password + '+cmd=' + cmd + (paramsUrl ? paramsUrl : '');
}

const getOutletsPower = (mac) => {
  const plug = plugs[mac];

  if (!plug) {
    console.log('Unknown plug: ', mac);
    return;
  }

  return fetch(cmdUrl(plug, 'getpower')).then((res) => res.text()).then((res) => {
    const statusesString = res.replace(/<\/?html>/g, '').replace(',SetTime', '').trim();
    const statusesStrings = statusesString.split(',');

    return _.map(statusesStrings, (statusString) => {
      const status = statusString.split('=');
      return parseInt(status[1]);
    });
  });
};

const sendAndRepeat = (url) => {
  fetch(url).then(() => {
    console.log('done: ' + url);
  }, (error) => {
    if (error) {
      console.log('retry: ' + url);
      console.log(error);
      setTimeout(() => {
        sendAndRepeat(url);
      }, 500 + Math.random() * 1000);
    }
  });
}

const SCHEDULE_PARAMS_ORDER = ['power', 'yy', 'mm', 'dd', 'hh', 'mn', 'ss', 'param', 'onoff'];
const updatePlugOutlets = (plug) => {
  if (!plug.ip || !plug.outlets) {
    return;
  }

  const date = new Date();
  _.forEach(plug.outlets, (outlet, i) => {
    /*if (outlet.type == 'timer') {
      const baseParams = {
        yy: date.getFullYear(),
        mm: (date.getMonth() + 1),
        dd: date.getDate(),
        ss: '00', param: 255,
      }

      const startTime = outlet.start.split('h');
      if (startTime.length != 2) {
	console.log('Wrong startTime format for plug ' + _.indexOf(plugs, plug) + ' outlet ' + i + '. Check spreadsheet');
	return;
      }
      const endTime = outlet.end.split('h');
      if (endTime.length != 2) {
	console.log('Wrong endTime format for plug ' + _.indexOf(plugs, plug) + ' outlet ' + i + '. Check spreadsheet');
	return;
      }
      sendAndRepeat(cmdUrl(plug, 'setschedule', _.merge(baseParams, {
        power: (outlet.index + 1) + 'a',
        hh: startTime[0],
        mn: startTime[1],
        onoff: 1,
      }), SCHEDULE_PARAMS_ORDER));
      sendAndRepeat(cmdUrl(plug, 'setschedule', _.merge(baseParams, {
        power: (outlet.index + 1) + 'b',
        hh: endTime[0],
        mn: endTime[1],
        onoff: 0,
      }), SCHEDULE_PARAMS_ORDER));
    } else {*/
      const baseParams = {
        yy: 2000,
        mm: '01',
        dd: '01',
        ss: '00', param: '000',
        hh: '00',
        mn: '00',
        onoff: 0,
      }

      sendAndRepeat(cmdUrl(plug, 'setschedule', _.merge(baseParams, {
        power: (outlet.index + 1) + 'b',
      }), SCHEDULE_PARAMS_ORDER));
      sendAndRepeat(cmdUrl(plug, 'setschedule', _.merge(baseParams, {
        power: (outlet.index + 1) + 'a',
      }), SCHEDULE_PARAMS_ORDER));
    //}
  });
}

const updatePlugPower = () => {
  _.forEach(plugs, (plug, plugIndex) => {
    if (!plug.ip || !plug.outlets) {
      return;
    }

    getOutletsPower(plug.mac).then((statuses) => {
      _.forEach(plug.outlets, (outlet) => {
	let isOn;
	let isOnFor;
	let isOffFor;
	if (outlet.type == 'timer') {
	  const startTime = _.map(outlet.start.split('h'), (v) => parseInt(v, 10));
	  if (startTime.length != 2) {
	    console.log('Wrong startTime format for plug ' + plugIndex + ' outlet ' + i + '. Check spreadsheet');
	    return;
	  }
	  const endTime = _.map(outlet.end.split('h'), (v) => parseInt(v, 10));
	  if (endTime.length != 2) {
	    console.log('Wrong endTime format for plug ' + plugIndex + ' outlet ' + i + '. Check spreadsheet');
	    return;
	  }
	  if (endTime[0] < startTime[0]) {
	    endTime[0] += 24;
	  }

	  const currentHour = new Date().getHours();
	  const currentMin = new Date().getMinutes();

	  const minTime = currentHour * 60 + currentMin;
	  const endMinTime = endTime[0] * 60 + endTime[1];
	  const startMinTime = startTime[0] * 60 + startTime[1];

	  isOn = minTime >= startMinTime && minTime <= endMinTime;
	  isOnFor = (endMinTime - minTime) * 60;
	  isOffFor = (startMinTime - minTime) * 60;
	} else if (outlet.type == 'interval') {
          const secs = parseInt(new Date().getTime() / 1000);
          const every = parseInt(outlet.every * 60);
          const during = parseInt(outlet.during * 60);
          const period = every + during;

	  isOn = (secs % period) > every;
          isOnFor = during - ((secs % period) - every);
          isOffFor = every - (secs % period);
	}

	const needsRefresh = isOn != statuses[outlet.index];
	if (!needsRefresh) {
	  const state = isOn ? 'on' : 'off';
	  const duration = isOn ? isOnFor : isOffFor;
	  console.log('plug ' + plugIndex + ' outlet ' + outlet.index + ' type ' + outlet.type + ' still in state ' + state + ' for ' + duration + ' sec');
	  return;
	}

	if (isOn) {
	  console.log('plug ' + plugIndex + ' outlet ' + outlet.index + ' type ' + outlet.type + ' should be on for ' + isOnFor + ' sec');
	  const params = {};
	  params['p6' + (outlet.index + 1)] = 1;
	  params['p6' + (outlet.index + 1) + 'n'] = 0;
	  params['t6' + (outlet.index + 1)] = isOnFor;
	  sendAndRepeat(cmdUrl(plug, 'setpower', params));
	} else {
	  console.log('plug ' + plugIndex + ' outlet ' + outlet.index + ' type ' + outlet.type + ' should be off for ' + isOffFor + ' sec');
	  const params = {};
	  params['p6' + (outlet.index + 1)] = 0;
	  sendAndRepeat(cmdUrl(plug, 'setpower', params));
	}
      });
    });

  });
  setTimeout(updatePlugPower, 5000);
}

client.addLocalDefinition('action', 'IP9258_ADD_PLUG', [
  {
    'name': 'mac',
    'type': 'string',
    'units': 'mac address',
  },
  {
    'name': 'login',
    'type': 'string',
    'units': '',
  },
  {
    'name': 'password',
    'type': 'string',
    'units': '',
  }
]);

client.addLocalDefinition('action', 'IP9258_OUTLETS', [
  {
    'name': 'mac',
    'type': 'string',
    'units': 'mac address',
  },
  {
    'name': 'start',
    'type': 'string',
    'units': 'hr:min',
  },
  {
    'name': 'end',
    'type': 'string',
    'units': 'hr:min',
  },
]);

let plugs = {};

try {
  plugs = require('./plugs.json');
  plugs = _.reduce(_.keys(plugs), (v, mac) => {
    const plug = plugs[mac];
    plug.ip = null;
    v[mac] = plug;
    return v;
  }, {});
} catch (e) {
}

const storeConfig = () => {
  fs.writeFile( "plugs.json", JSON.stringify( plugs ), "utf8" );
}

client.actionHandlers.attach('IP9258_ADD_PLUG', (a) => {
  if (plugs[a.data.mac]) {
    return;
  }

  const entry = arp.previous[a.data.mac];
  const plug = a.data;
  plug.ip = entry;
  plugs[a.data.mac] = plug;
  updatePlugOutlets(plug);
  storeConfig();
});

client.actionHandlers.attach('IP9258_OUTLETS', (a) => {
  const mac = a.data.mac;
  const plug = plugs[mac];

  if (!plug) {
    console.log('Unknown plug: ', mac);
    return;
  }

  plug.outlets = a.data.outlets;
  updatePlugOutlets(plug);
  storeConfig();
});

client.onReady(() => {
  console.log('connected');
  updatePlugPower();
});

client.connect();
