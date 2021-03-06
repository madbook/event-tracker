!function(global) {
  'use strict';

  // Aggressively match any non-numeric or alphebetic character. Also catches
  // utf8, which is probably for the best.
  var CLIENT_NAME_INVALID_CHARACTERS = /[^A-Za-z0-9]/;

  // Stub out `now` so we can use a more precise number in uuid generation, if
  // available.
  function now() {
    if (global.performance && typeof global.performance.now === 'function') {
      return global.performance.now();
    } else if (typeof Date.now === 'function') {
      return Date.now();
    } else {
      return (new Date()).getTime();
    }
  }

  // Pulled from elsewhere
  function uuid(){
    var d = now();

    var id = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      var r = (d + Math.random()*16) % 16 | 0;
      d = Math.floor(d / 16);
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });

    return id;
  }

  /*
   * Create a new event tracker.
   *
   * clientKey: the name of the secret key you must have to send events, like 'Test1'
   * clientSecret: the secret key you must have to send events, like 'ab42sdfsafsc'
   * postData: a function with the object arg ({url, data, query, headers, done}).
   *   You'll supply a function that wraps jQuery.ajax or superagent.
   * eventsUrl: the url of the events endpoint, like 'https://stats.redditmedia.com/events'
   * appName: the name of your client app, like 'Alien Blue'
   * calculateHash: a function that takes (key, string) and returns an HMAC
   * config: an object containing optional configuration, such as:
   *   bufferTimeout: an integer, after which ms, the buffer of events is sent
   *     to the `postData` function;
   *   bufferLength: an integer, after which the buffer contains this many
   *     items, the buffer of events is sent to the `postData` function;
   */
  function EventTracker(clientKey, clientSecret, postData, eventsUrl, appName, calculateHash, config) {
    config = config || {};

    if (!clientKey) {
      throw('Missing key; pass in event client key as the first argument.');
    }

    this.clientKey = clientKey;

    if (!clientSecret) {
      throw('Missing secret; pass in event client secret as the second argument.');
    }

    this.clientSecret = clientSecret;

    if (!postData) {
      throw('Missing post function; pass in ajax post function as the third argument.');
    }

    this.postData = postData;

    if (!eventsUrl) {
      throw('Missing url to post to; pass in url as the fourth argument.');
    }

    this.eventsUrl = eventsUrl;

    if (!appName) {
      throw('Missing appName; pass in appName as the fifth argument.');
    }

    this.appName = appName;

    if (!calculateHash) {
      throw('Missing calculateHash; pass in calculateHash as the sixth argument.');
    }

    this.calculateHash = calculateHash;

    if (typeof window !== 'undefined') {
      this.appendClientContext =
        typeof config.appendClientContext === 'undefined' ? true : config.appendClientContext;
    }

    this.bufferTimeout = config.bufferTimeout || 100;
    this.bufferLength = config.bufferLength || 40;
    this.buffer = [];
  }

  /*
   * Add an event to the buffer.
   *
   * topic: an event topic (such as `mod_events`)
   * type: an event type for your topic (such as `ban)
   * data payload: extra data, send whatever your heart desires
   */
  EventTracker.prototype.track = function trackEvent (topic, type, payload) {
    var data = this._buildData(topic, type, payload || {});
    this._buffer(data);
  };

  /*
   * Immediately flush the buffer. Called internally as well during buffer
   * timeout.
   * done: optional callback to fire on complete.
   */
  EventTracker.prototype.send = function send(done) {
    if (this.buffer.length) {
      var data = JSON.stringify(this.buffer);

      var hash = this.calculateHash(this.clientSecret, data);

      var headers = {
        'Content-Type': 'text/plain',
      };

      this.postData({
        url: this.eventsUrl,
        data: data,
        headers: headers,
        query: {
          key: this.clientKey,
          mac: hash,
        },
        done: done || function() {},
      });

      this.buffer = [];
    }
  };

  EventTracker.prototype._validateClientName = function validateClientName(name) {
    if (CLIENT_NAME_INVALID_CHARACTERS.test(name)) {
      throw('Invalid client name, please use only letters or numbers', name);
    }
  }

  /*
   * Internal. Formats a payload to be sent to the event tracker.
   */
  EventTracker.prototype._buildData = function buildData (topic, type, payload) {
    var now = new Date();

    var data = {
      event_topic: topic,
      event_type: type,
      event_ts: now.getTime(),
      uuid: payload.uuid || uuid(),
      payload: payload,
    };

    data.payload.app_name = this.appName;
    data.payload.utc_offset = now.getTimezoneOffset() / -60;

    if (this.appendClientContext) {
      var clientContext = this._buildClientContext();
      for (var c in clientContext) {
        data.payload[c] = clientContext[c];
      }
    }

    return data;
  };

  /*
   * Internal. Adds events to the buffer, and flushes if necessary.
   */
  EventTracker.prototype._buffer = function buffer(data) {
    this.buffer.push(data);

    if (this.buffer.length >= this.bufferLength || !this.bufferTimeout) {
      this.send();
    } else if (this.bufferTimeout && !this.timer) {
      this._resetTimer();
    }
  }

  /*
   * Internal. Resets the buffer timeout.
   */
  EventTracker.prototype._resetTimer = function resetTimer() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }

    var tracker = this;
    this.timer = setTimeout(function() {
      tracker.send();
      tracker.timer = undefined;
    }, this.bufferTimeout);
  }

  /*
   * Internal. Adds certain browser-based properties to the payload if
   * configured to do so.
   */
  EventTracker.prototype._buildClientContext = function buildClientContext () {
    return {
      user_agent: navigator.userAgent,
      domain: document.location.host,
      base_url: document.location.pathname + document.location.search + document.location.hash,
    }
  }

  // Handle npm modules and window globals
  if (typeof module !== 'undefined') {
    module.exports = EventTracker;
  } else {
    global.EventTracker = EventTracker;
  }
}(typeof global !== 'undefined' ? global : this);
