import { assert } from 'chai';
import { fromJS } from 'immutable';
import pruneState from './pruneState';

/* eslint-disable no-undef */
describe('pruining operation', () => {
  it('prunes correctly', () => {
    const state = fromJS({
      runtime: {
        abc: 'def',
        ghi: 'jkl',
        mno: 'target',
      },
      gameplay: {
        pqr: 'foo',
        target: {
          a: {
            extraneous: 123,
            target: 456,
          },
          b: {
            array: [123, 456],
          },
        },
      },
      something: {
        list: [
          {
            stu: 456,
            vwx: 556,
          },
          {
            target: 'yza',
            extraneous: 'bcd',
          },
        ],

      },
    });

    const pruned = pruneState(state, 'target');

    const expected = {
      runtime: {
        abc: 'def',
        ghi: 'jkl',
        mno: 'target',
      },
      gameplay: {
        target: {
          a: {
            target: 456,
          },
          b: {
            array: [123, 456],
          },
        },
      },
      something: {
        list: [
          {
            stu: 456,
            vwx: 556,
          },
          {
            target: 'yza',
          },
        ],
      },
    };
    assert.deepEqual(pruned.toJS(), expected);
  });
});
/* eslint-enable no-undef */
