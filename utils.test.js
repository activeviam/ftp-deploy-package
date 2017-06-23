/* eslint-env jest */

'use strict';

const {getLeaveDirectories} = require('./utils');

describe('getLeaveDirectories', () => {
  test('with only root level files', () => {
    expect(getLeaveDirectories(['a.js', 'b.js'])).toEqual([]);
  });

  test('with several leaves', () => {
    expect(
      getLeaveDirectories([
        'a.js',
        'b.js',
        'd1/a.js',
        'd2/s1/b.js',
        'd1/s2/c.js',
      ])
    ).toEqual(['d2/s1', 'd1/s2']);
  });

  test('with a different order', () => {
    expect(
      getLeaveDirectories([
        'd1/s2/c.js',
        'a.js',
        'd2/s1/b.js',
        'b.js',
        'd1/a.js',
      ])
    ).toEqual(['d1/s2', 'd2/s1']);
  });
});
