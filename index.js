'use strict';

const _ = require('lodash');

var request = require('request');

const client = new require('rotonde-client/node/rotonde-client')('ws://rotonde:4224');

const arp = new require('arp-monitor')();

arp.on('in', (node) => {
  const plug = plugs[node.mac];
  if (plug) {
    console.log('Got: ', plug, ' ', node);
    plug.ip = node.ip;
    updatePlug(plug);
  }
});

arp.on('out', (node) => {
  const plug = plugs[node.mac];
  if (plug) {
    console.log('Lost plug: ', plug);
    plug.ip = null;
  }
});

const updatePlug = (plug) => {
  if (!plug.ip || !plug.timer) {
    return;
  }

  _.times(4, (i) => {
    const startTime = plug.timer.start.split('h');
    request('http://' + plug.ip + '/set.cmd?user=' + plug.login + '+pass=' + plug.password + '+cmd=setschedule+power=' + (i + 1) + 'a+yy=2018+mm=01+dd=01+hh=' + startTime[0] + '+mn=' + startTime[1] + '+ss=00+param=255+onoff=1', (error, response, body) => {
      if (error) {
        console.log(error);
      }
    });

    const endTime = plug.timer.end.split('h');
    request('http://' + plug.ip + '/set.cmd?user=' + plug.login + '+pass=' + plug.password + '+cmd=setschedule+power=' + (i + 1) + 'b+yy=2018+mm=01+dd=01+hh=' + endTime[0] + '+mn=' + endTime[1] + '+ss=00+param=255+onoff=0', (error, response, body) => {
      if (error) {
        console.log(error);
      }
    });
  });
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

client.addLocalDefinition('action', 'IP9258_TIMER', [
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

const plugs = {};

client.actionHandlers.attach('IP9258_ADD_PLUG', (a) => {
  if (plugs[a.data.mac]) {
    return;
  }

  const entry = arp.previous[a.data.mac];
  const plug = a.data;
  plug.ip = entry;
  plugs[a.data.mac] = plug;
  updatePlug(plug);
});

client.actionHandlers.attach('IP9258_TIMER', (a) => {
  const mac = a.data.mac;
  const plug = plugs[mac];

  if (!plug) {
    console.log('Unknown plug: ', mac);
    return;
  }

  plug.timer = a.data;
  updatePlug(plug);
});

client.onReady(() => {
  console.log('connected');
});

client.connect();
