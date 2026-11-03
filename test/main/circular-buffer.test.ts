import CircularBuffer from '../../src/common/CircularBuffer';

describe('CircularBuffer', () => {
  test('keeps the newest entries when a full buffer receives a batch', () => {
    const buffer = CircularBuffer.fromArray([1, 2, 3], 3);

    buffer.pushAll([4, 5]);

    expect(buffer.toArray()).toEqual([3, 4, 5]);
  });
});
