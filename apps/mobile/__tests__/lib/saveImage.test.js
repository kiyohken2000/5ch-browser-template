import { imageMimeType, saveFolderLabel } from 'lib/saveImage'

describe('saveFolderLabel', () => {
  test.each([
    [
      'content://com.android.externalstorage.documents/tree/primary%3APictures%2FEmber',
      'Pictures/Ember',
    ],
    [
      'content://com.android.externalstorage.documents/tree/primary%3A',
      '内部ストレージ',
    ],
    [
      'content://com.android.externalstorage.documents/tree/1234-ABCD%3ADCIM',
      '1234-ABCD:DCIM',
    ],
    ['content://example/other', 'content://example/other'],
    [null, ''],
  ])('%s → %s', (uri, want) => {
    expect(saveFolderLabel(uri)).toBe(want)
  })
})

describe('imageMimeType', () => {
  test.each([
    ['1_a.PNG', 'image/png'],
    ['1_a.gif', 'image/gif'],
    ['1_a.jpeg', 'image/jpeg'],
    ['1_a', 'image/jpeg'],
  ])('%s → %s', (name, want) => {
    expect(imageMimeType(name)).toBe(want)
  })
})
