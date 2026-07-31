// test/setup.js
// jsdom returns an all-zero rect from getBoundingClientRect(), which is enough
// for most assertions (offset 0,0) but we give it a realistic width/height so
// components that divide by rect size don't produce NaN/Infinity.
Element.prototype.getBoundingClientRect = () => ({
  left: 0,
  top: 0,
  right: 960,
  bottom: 540,
  width: 960,
  height: 540,
  x: 0,
  y: 0,
  toJSON() {},
})
