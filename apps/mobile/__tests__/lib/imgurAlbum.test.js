import { getBytes } from 'lib/http'
import {
  fetchImgurAlbum,
  getCachedImgurAlbum,
  imgurCoverFromOgImage,
  parseImgurEmbed,
} from 'lib/imgurAlbum'
import { fetchOgp } from 'lib/ogp'

jest.mock('lib/http', () => ({
  ...jest.requireActual('lib/http'),
  getBytes: jest.fn(),
}))
jest.mock('lib/ogp', () => ({
  ...jest.requireActual('lib/ogp'),
  fetchOgp: jest.fn(),
}))

const bytesOf = (text) => ({
  status: 200,
  bytes: new Uint8Array(Buffer.from(text, 'utf8')),
  headers: { get: () => 'text/html; charset=utf-8' },
})

// 実物の埋め込みページと同じ書き方（間に空白が並ぶ）
const embedHtml = (images, count = images.length) =>
  `<script>(function() {
    var images            = ${JSON.stringify({ count, images })};
    var other = {"a":"}"};
  })();</script>`

describe('parseImgurEmbed', () => {
  it('画像の直リンクを並べ、動画は除く', () => {
    const html = embedHtml(
      [
        { hash: 'bjLKzIF', title: '{ } "', ext: '.jpg' },
        { hash: 'Vid0001', ext: '.mp4' },
        { hash: 'Png0002', ext: '.PNG' },
      ],
      4,
    )
    expect(parseImgurEmbed(html)).toEqual({
      images: [
        'https://i.imgur.com/bjLKzIF.jpg',
        'https://i.imgur.com/Png0002.png',
      ],
      unlisted: 1,
    })
  })

  it('データが無ければ null', () => {
    expect(parseImgurEmbed('<html>no data</html>')).toBeNull()
    expect(parseImgurEmbed('var images = {broken')).toBeNull()
  })
})

describe('imgurCoverFromOgImage', () => {
  it('クエリを落として直リンクにする', () => {
    expect(imgurCoverFromOgImage('https://i.imgur.com/bjLKzIF.jpeg?fb')).toBe(
      'https://i.imgur.com/bjLKzIF.jpeg',
    )
  })
  it('i.imgur.com 以外は使わない', () => {
    expect(imgurCoverFromOgImage('https://s.imgur.com/images/logo.png')).toBe(
      null,
    )
    expect(imgurCoverFromOgImage(null)).toBe(null)
  })
})

describe('fetchImgurAlbum', () => {
  beforeEach(() => {
    getBytes.mockReset()
    fetchOgp.mockReset()
    jest.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => {
    console.warn.mockRestore()
  })

  it('埋め込みページから解決し、結果を覚えておく', async () => {
    getBytes.mockResolvedValue(
      bytesOf(embedHtml([{ hash: 'bjLKzIF', ext: '.jpg' }])),
    )
    const url = 'https://imgur.com/a/beM1zmX'
    const album = await fetchImgurAlbum(url)
    expect(album).toEqual({
      images: ['https://i.imgur.com/bjLKzIF.jpg'],
      unlisted: 0,
    })
    expect(getBytes.mock.calls[0][0]).toBe(
      'https://imgur.com/a/beM1zmX/embed?pub=true',
    )
    expect(getCachedImgurAlbum(url)).toEqual(album)
    await fetchImgurAlbum(url)
    expect(getBytes).toHaveBeenCalledTimes(1)
  })

  it('埋め込みページが取れなければ表紙 1 枚で代用する', async () => {
    getBytes.mockRejectedValue(new Error('404'))
    fetchOgp.mockResolvedValue({
      title: 'imgur.com',
      image: 'https://i.imgur.com/Cov0001.jpeg?fb',
    })
    expect(await fetchImgurAlbum('https://imgur.com/gallery/Gal0002')).toEqual({
      images: ['https://i.imgur.com/Cov0001.jpeg'],
      unlisted: 0,
    })
    expect(fetchOgp).toHaveBeenCalledWith('https://imgur.com/gallery/Gal0002')
  })

  it('動画だけのアルバムや解決できないアルバムは null', async () => {
    getBytes.mockResolvedValue(
      bytesOf(embedHtml([{ hash: 'Vid0003', ext: '.mp4' }])),
    )
    expect(await fetchImgurAlbum('https://imgur.com/a/Vid0003')).toBeNull()
    expect(getCachedImgurAlbum('https://imgur.com/a/Vid0003')).toBeNull()

    getBytes.mockRejectedValue(new Error('404'))
    fetchOgp.mockResolvedValue(null)
    expect(await fetchImgurAlbum('https://imgur.com/a/Dead004')).toBeNull()
  })
})
