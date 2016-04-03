'use strict';

const _ = require('lodash');
const fs = require("fs");

var fetch = require('node-fetch');

const client = new require('rotonde-client/node/rotonde-client')('ws://rotonde:4224');

const arp = new require('arp-monitor')();

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

arp.on('in', (node) => {
  const plug = plugs[node.mac];
  if (plug) {
    plug.ip = node.ip;
    console.log('Got: ', plug);
    updatePlugOutlets(plug);
  }
});

arp.on('out', (node) => {
  const plug = plugs[node.mac];
  if (plug) {
    console.log('Lost plug: ', plug);
    plug.ip = null;
  }
});

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
  _.forEach(plug.outlets, (outlet) => {
    if (outlet.type == 'timer') {
      const baseParams = {
        yy: date.getFullYear(),
        mm: (date.getMonth() + 1),
        dd: date.getDate(),
        ss: '00', param: 255,
      }

      const startTime = outlet.start.split('h');
      sendAndRepeat(cmdUrl(plug, 'setschedule', _.merge(baseParams, {
        power: (outlet.index + 1) + 'a',
        hh: startTime[0],
        mn: startTime[1],
        onoff: 1,
      }), SCHEDULE_PARAMS_ORDER));
      const endTime = outlet.end.split('h');
      sendAndRepeat(cmdUrl(plug, 'setschedule', _.merge(baseParams, {
        power: (outlet.index + 1) + 'b',
        hh: endTime[0],
        mn: endTime[1],
        onoff: 0,
      }), SCHEDULE_PARAMS_ORDER));
    } else {
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
    }
  });
}

const updatePlugPower = () => {
  _.forEach(plugs, (plug) => {
    if (!plug.ip || !plug.outlets) {
      return;
    }

    getOutletsPower(plug.mac).then((statuses) => {
      _.forEach(plug.outlets, (outlet) => {
        if (outlet.type == 'interval') {
          const secs = parseInt(new Date().getTime() / 1000);
          const every = parseInt(outlet.every * 60);
          const during = parseInt(outlet.during * 60);
          const period = every + during;
          const isOn = (secs % period) > every;
          const isOnFor = during - ((secs % period) - every);
          const isOffFor = every - (secs % period);
          const needsRefresh = isOn != statuses[outlet.index];

          if (!needsRefresh) {
            const state = isOn ? 'on' : 'off';
            const duration = isOn ? isOnFor : isOffFor;
            console.log('outlet ' + outlet.index + ' still in state ' + state + ' for ' + duration + ' sec');
            return;
          }

          if (isOn) {
            console.log('outlet ' + outlet.index + ' should be on for ' + isOnFor + ' sec');
            const params = {};
            params['p6' + (outlet.index + 1)] = 1;
            params['p6' + (outlet.index + 1) + 'n'] = 0;
            params['t6' + (outlet.index + 1)] = isOnFor;
            sendAndRepeat(cmdUrl(plug, 'setpower', params));
          } else {
            console.log('outlet ' + outlet.index + ' should be off for ' + isOffFor + ' sec');
            const params = {};
            params['p6' + (outlet.index + 1)] = 0;
            sendAndRepeat(cmdUrl(plug, 'setpower', params));
          }
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
