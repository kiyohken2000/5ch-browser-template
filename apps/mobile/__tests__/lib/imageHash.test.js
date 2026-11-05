import {
  hammingDistance,
  hashFromPixels,
  HASH_HEIGHT,
  HASH_WIDTH,
  isHashBlocked,
} from 'lib/imageHash'
import {
  appendUploadUrl,
  buildMultipart,
  MAX_UPLOAD_HISTORY,
  parseUploadResponse,
  pushUploadHistory,
  uploadFileName,
  uploadFormat,
} from 'lib/upload'

jest.mock('expo-image', () => ({ Image: {} }))
jest.mock('lib/storage', () => ({ KEYS: {}, load: jest.fn(), save: jest.fn() }))
jest.mock('expo-file-system', () => ({ File: jest.fn() }))
jest.mock('expo-image-manipulator', () => ({
  ImageManipulator: {},
  SaveFormat: {},
}))

function pixels(valueAt) {
  const out = new Uint8Array(HASH_WIDTH * HASH_HEIGHT * 4)
  for (let y = 0; y < HASH_HEIGHT; y += 1) {
    for (let x = 0; x < HASH_WIDTH; x += 1) {
      const v = valueAt(x, y)
      const at = (y * HASH_WIDTH + x) * 4
      out[at] = v
      out[at + 1] = v
      out[at + 2] = v
      out[at + 3] = 255
    }
  }
  return out
}

describe('hashFromPixels', () => {
  it('64 ビットを 16 桁で返す', () => {
    expect(hashFromPixels(pixels((x) => x * 20))).toBe('ffffffffffffffff')
    expect(hashFromPixels(pixels((x) => 200 - x * 20))).toBe('0000000000000000')
  })

  it('明るさが全体に変わっても同じ値になる', () => {
    const base = (x, y) => (x * 13 + y * 29) % 120
    expect(hashFromPixels(pixels((x, y) => base(x, y) + 80))).toBe(
      hashFromPixels(pixels(base)),
    )
  })
})

describe('hammingDistance', () => {
  it('違うビットを数える', () => {
    expect(hammingDistance('00', '00')).toBe(0)
    expect(hammingDistance('00', '01')).toBe(1)
    expect(hammingDistance('0f', 'f0')).toBe(8)
  })

  it('比べられないものは大きな値', () => {
    expect(hammingDistance('00', '000')).toBe(999)
    expect(hammingDistance(null, '00')).toBe(999)
  })
})

describe('isHashBlocked', () => {
  const entries = [{ hash: '0000000000000000' }]

  it('しきい値までの違いは同じ画像と見なす', () => {
    expect(isHashBlocked('000000000000000f', entries, 4)).toBe(true)
    expect(isHashBlocked('000000000000000f', entries, 3)).toBe(false)
  })

  it('無効な項目と、ハッシュの無い画像は隠さない', () => {
    expect(
      isHashBlocked(
        '0000000000000000',
        [{ ...entries[0], disabled: true }],
        10,
      ),
    ).toBe(false)
    expect(isHashBlocked(null, entries, 10)).toBe(false)
  })
})

describe('parseUploadResponse', () => {
  it('新しい形を読む', () => {
    expect(
      parseUploadResponse({
        success: true,
        post_id: 'https://tadaup.jp/p',
        url: ['https://tadaup.jp/a.jpg'],
      }),
    ).toEqual({
      sourceUrl: 'https://tadaup.jp/a.jpg',
      thumbnail: 'https://tadaup.jp/a.jpg',
      pageUrl: 'https://tadaup.jp/p',
    })
  })

  it('古い形を読む', () => {
    expect(
      parseUploadResponse({
        success: true,
        source_url: 'https://t/a.jpg',
        thumbnail: 'https://t/s.jpg',
        url: 'https://t/p',
      }),
    ).toEqual({
      sourceUrl: 'https://t/a.jpg',
      thumbnail: 'https://t/s.jpg',
      pageUrl: 'https://t/p',
    })
  })

  it('失敗や、URL の無い応答は例外にする', () => {
    expect(() => parseUploadResponse({ success: false, message: 'x' })).toThrow(
      'x',
    )
    expect(() => parseUploadResponse({ success: true })).toThrow('URL')
    expect(() =>
      parseUploadResponse({ success: true, source_url: 'data:text/plain,x' }),
    ).toThrow('URL')
  })
})

describe('アップロードの補助', () => {
  it('multipart の本文を作る', () => {
    const body = buildMultipart({
      boundary: 'B',
      fileName: 'a"\r\nX: y.jpg',
      mime: 'image/jpeg',
      bytes: new Uint8Array([1, 2, 3]),
    })
    const text = Buffer.from(body).toString('utf8')
    expect(text).toContain('name="title"\r\n\r\nうｐろだ\r\n')
    expect(text).toContain('name="r18"\r\n\r\nno\r\n')
    expect(text).toContain(
      'name="file[]"; filename="a___X__y.jpg"\r\nContent-Type: image/jpeg\r\n\r\n\u0001\u0002\u0003\r\n--B--\r\n',
    )
  })

  it('形式を決める。HEIC などは JPEG にする', () => {
    expect(uploadFormat({ mimeType: 'image/gif' })).toBe('gif')
    expect(uploadFormat({ fileName: 'a.PNG' })).toBe('png')
    expect(uploadFormat({ mimeType: 'image/heic', fileName: 'a.heic' })).toBe(
      'jpg',
    )
  })

  it('ファイル名の拡張子を送る形式に揃える', () => {
    expect(uploadFileName('a.heic', 'jpg')).toBe('a.jpg')
    expect(uploadFileName(null, 'png')).toBe('image.png')
  })

  it('本文に URL を足す', () => {
    expect(appendUploadUrl('', 'u')).toBe('u')
    expect(appendUploadUrl('本文', 'u')).toBe('本文\nu')
  })

  it('履歴は新しい順で、上限を超えない', () => {
    let history = []
    for (let i = 0; i < MAX_UPLOAD_HISTORY + 3; i += 1) {
      history = pushUploadHistory(history, { sourceUrl: String(i) })
    }
    expect(history).toHaveLength(MAX_UPLOAD_HISTORY)
    expect(history[0].sourceUrl).toBe(String(MAX_UPLOAD_HISTORY + 2))
  })
})
