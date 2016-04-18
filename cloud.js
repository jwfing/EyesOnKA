var AV = require('leanengine');
var Redis = require('redis');
var https = require('https');
var querystring = require('querystring');

var options = {
  host: 'hook.bearychat.com',
  port: 443,
  path: '/=bw52Y/incoming/8b047f7c00020d2d7595a54af3f0c326',
  method: 'POST',
  headers: {'Content-Type':'application/json'}
};

var RedisMonitorItem = AV.Object.extend('RedisMonitorItem');

/**
 * 一个简单的云代码方法
 */
AV.Cloud.define('hello', function(request, response) {
  send_notify('info', 'test message')
  response.success('Hello world!');
});

function send_notify(level, msg) {
  var post_data = JSON.stringify({
    'text': level.toUpperCase() + ' - ' +  msg,
  });
  var req = https.request(options, function(res) {
    console.log('\t  send notify to bearychat. response STATUS: ' + res.statusCode);
    res.setEncoding('utf8');
    res.on('data', function (chunk) {
    });
  });

  // write data to request body
  req.write(post_data + "\n");
  req.end();
}

var internal_monitor_key = "leancloud_internal_available_monitor_key";
var allowedMaxGap = 420;// 7 minitor, check interval: 5 min

AV.Cloud.define('redis_check_timer', function(req, res) {
  var currentTS = parseInt(new Date().getTime()/1000);//seconds

  var query = new AV.Query('RedisMonitorItem');
  query.equalTo('valid', true);
  query.find({
    success: function(results) {
      console.log('begin to check redis list. totalCount=', results.length);
      function checkRedisItem(i) {
        if (i < 0 || i >= results.length) {
          return;
        } else {
          var item = results[i];
          var redisHost = item.get('targetHost');
          var appName = item.get('appName');
          var appId = item.get('appId');
          var criticalKey = item.get('criticalKey');
          var expectedSize = item.get('expectedResultSize');
          var notifyUrl = item.get('notifyUrl');
          var instanceId = item.get('instanceId');
          var client = Redis.createClient(redisHost);
          console.log('  check item: appName=%s, targetRedis=%s, instanceId=%s, criticalKey=%s ...',
                       appName, redisHost, instanceId, criticalKey)
          client.on('error', function(err) {
            send_notify("warn", "UNKNOWN error. appName:" + appName + ", instanceId:" + instanceId);
            console.error('    UNKNOWN error. appName:%s, instanceId:%s, causeBy: %s', appName, instanceId, err);
            client.end();
            setTimeout(checkRedisItem(i+1), 2000);
            return;
          });
          client.on('connect', function() {
            client.exists(criticalKey, function(err, reply) {
              if (err || reply < 1) {
                send_notify("warn", "READ error. appName:" + appName + ", instanceId:" + instanceId + ', key:' + criticalKey);
                console.error('    READ error. appName:%s, instanceId:%s, causeBy:%s', appName, instanceId, err);
              } else {
                // do nothing.
                console.info('    criticalKey existed: ' + criticalKey)
              }
              // read internal monitor key
              client.get(internal_monitor_key, function(err, response){
                if (err || !response) {
                  send_notify("warn", "internal Key not exist. appName:" + appName + ", instanceId:"+ instanceId);
                  console.error('    READ internal key error. appName:%s, instanceId:%s, causeBy:%s', appName, instanceId, err)
                } else if (parseInt(response) + allowedMaxGap < currentTS) {
                  send_notify("warn", "Invalid internal Key. appName:" + appName + ", instanceId:"+ instanceId + ", internalValue:"+ response + ", currentTS:" + currentTS)
                  console.warn('    Invalid internal key. appName:%s, instanceId:%s, value:%s', appName, instanceId, response)
                } else {
                  console.info('    read internal monitor key:' + internal_monitor_key + ', value:' + response)
                }
                // write new value to internal monitor key
                client.set(internal_monitor_key, currentTS, function(err){
                  if (err) {
                    send_notify("warn", "WRITE error. appName:" + appName + ", instanceId:" + instanceId + ", key:" + internal_monitor_key);
                    console.error('    WRITE internal key error. appName:%s, instanceId:%s, causeBy:%s', appName, instanceId, err);
                  } else {
                    console.info('    set internal monitor key with value:' + currentTS)
                  }
                  client.end();
                  setTimeout(checkRedisItem(i+1), 2000);
                });
              });
            })
          });
        }
      }
      checkRedisItem(0);
      res.success(results.length)
    },
    error: function(error) {
      console.log('failed to query check item for redis service.');
      res.error('failed to exec monitor item query')
    }
  });
});

module.exports = AV.Cloud;
