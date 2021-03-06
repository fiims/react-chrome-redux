import 'babel-polyfill';

import should from 'should';
import sinon from 'sinon';

import { Store } from '../src';
import {
  DISPATCH_TYPE,
  STATE_TYPE,
  DIFF_STATUS_UPDATED,
  DIFF_STATUS_REMOVED,
} from '../src/constants';

describe('Store', function () {
  const portName = 'test';

  beforeEach(function () {
    // Mock chrome.runtime API
    global.chrome = {
      runtime: {
        connect() {
          return {
            onMessage: {
              addListener() {
              }
            }
          };
        },
        sendMessage(data, cb) {
          cb();
        }
      }
    };
  });

  describe('#new Store()', function () {
    let listeners;

    beforeEach(function () {
      // mock connect.onMessage listeners array
      listeners = [];

      // override mock chrome API for this test
      global.chrome.runtime.connect = () => {
        return {
          onMessage: {
            addListener: listener => {
              listeners.push(listener);
            }
          }
        };
      };
    });

    it('should setup a listener on the chrome port defined by the portName option', function () {
      new Store({portName});

      // verify one listener was added on port connect
      listeners.length.should.equal(1);
    });

    it('should call replaceState on new state messages', function () {
      const store = new Store({portName});

      // make replaceState() a spy function
      store.replaceState = sinon.spy();

      const [ l ] = listeners;

      const payload = {
        a: 1
      };

      // send one state type message
      l({
        type: STATE_TYPE,
        payload
      });

      // send one non-state type message
      l({
        type: `NOT_${STATE_TYPE}`,
        payload: {
          a: 2
        }
      });

      // make sure replace state was only called once
      store.replaceState.calledOnce.should.equal(true);
      store.replaceState.firstCall.args[0].should.eql(payload);
    });

    it('should deserialize incoming messages', function () {
      const deserializer = sinon.spy(JSON.parse);
      const store = new Store({portName, deserializer});

      // make replaceState() a spy function
      store.replaceState = sinon.spy();

      const [ l ] = listeners;

      const payload = {
        a: 1
      };

      // send one state type message
      l({
        type: STATE_TYPE,
        payload: JSON.stringify(payload)
      });

      // send one non-state type message
      l({
        type: `NOT_${STATE_TYPE}`,
        payload: JSON.stringify({
          a: 2
        })
      });

      // make sure replace state was called with the deserialized payload
      store.replaceState.firstCall.args[0].should.eql(payload);
    });

    it('should set the initial state to empty object by default', function () {
      const store = new Store({portName});

      store.getState().should.eql({});
    });

    it('should set the initial state to opts.state if available', function () {
      const store = new Store({portName, state: {a: 'a'}});

      store.getState().should.eql({a: 'a'});
    });
  });

  describe('#ready()', function () {
    it('should call Store.ready once on STATE_TYPE port message', async function () {
      // mock connect.onMessage listeners array
      const listeners = [];

      // override mock chrome API for this test
      global.chrome.runtime.connect = () => {
        return {
          onMessage: {
            addListener(listener) {
              listeners.push(listener);
            }
          }
        };
      };

      const store = new Store({portName}),
            readyCb = sinon.spy(),
            readyPromise = store.ready().then(() => {
              readyCb();
              return Promise.resolve();
            });

      // verify one listener was added on port connect
      listeners.length.should.equal(1);

      // verify Store.ready has not been called yet
      readyCb.callCount.should.equal(0);

      const [ l ] = listeners;

      // send one state type message, this should trigger the ready callback
      l({
        type: STATE_TYPE,
        payload: {}
      });

      // the Store.ready method is backed by a promise (inherent async
      // behavior), so we must wait
      await readyPromise;

      const badMessage = {
        type: `NOT_${STATE_TYPE}`,
        payload: {}
      };

      // send one non-state type message, this should not trigger the ready
      // callback
      l(badMessage);

      // send one state type message, this should not trigger the callback
      // since the store should have already been marked ready
      l({
        type: STATE_TYPE,
        payload: {}
      });

      // make sure replace state was only called once
      readyCb.calledOnce.should.equal(true);
    });
  });

  describe('#patchState()', function () {
    it('should patch the state of the store', function () {
      const store = new Store({ portName, state: { b: 1 } });

      store.getState().should.eql({ b: 1 });

      store.patchState([
        { key: 'a', value: 123, change: DIFF_STATUS_UPDATED },
        { key: 'b', change: DIFF_STATUS_REMOVED },
      ]);

      store.getState().should.eql({ a: 123 });
    });
  });

  describe('#replaceState()', function () {
    it('should replace the state of the store', function () {
      const store = new Store({portName});

      store.getState().should.eql({});

      store.replaceState({a: 'a'});

      store.getState().should.eql({a: 'a'});
    });
  });

  describe('#getState()', function () {
    it('should get the current state of the Store', function () {
      const store = new Store({portName, state: {a: 'a'}});

      store.getState().should.eql({a: 'a'});

      store.replaceState({b: 'b'});

      store.getState().should.eql({b: 'b'});
    });
  });

  describe('#subscribe()', function () {
    it('should register a listener for state changes', function () {
      const store = new Store({portName}),
            newState = {b: 'b'};

      let callCount = 0;

      store.subscribe(() => {
        callCount += 1;
        store.getState().should.eql(newState);
      });

      store.replaceState(newState);

      callCount.should.eql(1);
    });

    it('should return a function which will unsubscribe the listener', function () {
      const store = new Store({portName}),
            listener = sinon.spy(),
            unsub = store.subscribe(listener);

      store.replaceState({b: 'b'});

      listener.calledOnce.should.eql(true);

      unsub();

      store.replaceState({c: 'c'});

      listener.calledOnce.should.eql(true);
    });
  });

  describe('#dispatch()', function () {
    it('should send a message with the correct dispatch type and payload given an extensionId', function () {
      const spy = global.chrome.runtime.sendMessage = sinon.spy(),
            store = new Store({portName, extensionId: 'xxxxxxxxxxxx'});

      store.dispatch({a: 'a'});

      spy.calledOnce.should.eql(true);
      spy.alwaysCalledWith('xxxxxxxxxxxx', {
        type: DISPATCH_TYPE,
        portName,
        payload: {a: 'a'}
      }).should.eql(true);
    });

    it('should send a message with the correct dispatch type and payload not given an extensionId', function () {
      const spy = global.chrome.runtime.sendMessage = sinon.spy(),
            store = new Store({portName});

      store.dispatch({a: 'a'});

      spy.calledOnce.should.eql(true);
      spy.alwaysCalledWith(null, {
        type: DISPATCH_TYPE,
        portName,
        payload: {a: 'a'}
      }).should.eql(true);
    });

    it('should serialize payloads before sending', function () {
      const spy = global.chrome.runtime.sendMessage = sinon.spy(),
            serializer = sinon.spy(JSON.stringify),
            store = new Store({portName, serializer});

      store.dispatch({a: 'a'});

      spy.calledOnce.should.eql(true);
      spy.alwaysCalledWith(null, {
        type: DISPATCH_TYPE,
        portName,
        payload: JSON.stringify({a: 'a'})
      }).should.eql(true);
    });

    it('should return a promise that resolves with successful action', function () {
      global.chrome.runtime.sendMessage = (extensionId, data, options, cb) => {
        cb({value: {payload: 'hello'}});
      };

      const store = new Store({portName}),
            p = store.dispatch({a: 'a'});

      return p.should.be.fulfilledWith('hello');
    });

    it('should return a promise that rejects with an action error', function () {
      global.chrome.runtime.sendMessage = (extensionId, data, options, cb) => {
        cb({value: {payload: 'hello'}, error: {extraMsg: 'test'}});
      };

      const store = new Store({portName}),
            p = store.dispatch({a: 'a'});

      return p.should.be.rejectedWith(Error, {extraMsg: 'test'});
    });

    it('should return a promise that resolves with undefined for an undefined return value', function () {
      global.chrome.runtime.sendMessage = (extensionId, data, options, cb) => {
        cb({value: undefined});
      };

      const store = new Store({portName}),
            p = store.dispatch({a: 'a'});

      return p.should.be.fulfilledWith(undefined);
    });
  });

  describe("when validating options", function () {
    it('should throw an error if portName is not present', function () {
      should.throws(() => {
        new Store();
      }, Error);
    });

    it('should throw an error if serializer is not a function', function () {
      should.throws(() => {
        new Store({portName, serializer: "abc"});
      }, Error);
    });

    it('should throw an error if deserializer is not a function', function () {
      should.throws(() => {
        new Store({portName, deserializer: "abc"});
      }, Error);
    });
  });
});
