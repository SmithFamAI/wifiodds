#!/usr/bin/env node
'use strict';

var assert = require('assert');
var rank = require('./lib/home-order.js').rank;
var seed = ['alaska', 'virginatlantic', 'united', 'emirates'];

assert.deepStrictEqual(rank(seed, function (key) {
  return {
    alaska: { odds: 30, connect: 50 },
    virginatlantic: { odds: 28, connect: 55 },
    united: { odds: 28, connect: 54 },
    emirates: { odds: 20, connect: 60 }
  }[key];
}), seed, 'seed order remains when it already matches the score contract');

assert.deepStrictEqual(rank(seed, function (key) {
  return {
    alaska: { odds: 30, connect: 50 },
    virginatlantic: { odds: 28, connect: 55 },
    united: { odds: 29, connect: 54 },
    emirates: { odds: 20, connect: 60 }
  }[key];
}), ['alaska', 'united', 'virginatlantic', 'emirates'],
'a daily score crossover changes the server-rendered order');

assert.deepStrictEqual(rank(seed, function (key) {
  return { odds: key === 'emirates' ? 20 : 28, connect: key === 'alaska' ? 50 : 55 };
}), ['virginatlantic', 'united', 'alaska', 'emirates'],
'equal odds use ConnectScore, then preserve the seed order for exact ties');

assert.throws(function () {
  rank(['broken'], function () { return { odds: NaN, connect: 1 }; });
}, /missing finite scores/, 'invalid score data fails closed');

console.log('home-order controls: 4 passed');
