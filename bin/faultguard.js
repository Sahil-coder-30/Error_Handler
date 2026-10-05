#!/usr/bin/env node
/**
 * @file bin/faultguard.js
 * @description Backward-compatible CLI alias forwarding to bin/faultkit.js
 */

"use strict";

const { main } = require("./faultkit.js");
main();
