import axios from 'axios'
import { TimeoutError } from './errors'

const whitelist = /chrome:\/\/|edge:\/\/|file:\/\/|localhost:|127.0.0.1/i

async function checkURL(url: string | undefined, timeout: number) {
  if (!url || whitelist.test(url))
    return Promise.resolve()

  return axios.get(url, {
    timeout: timeout * 1000,
  })
}

async function checkURLByFetch(url: string | undefined, timeout: number) {
  if (!url || whitelist.test(url))
    return Promise.resolve()

  const controller = new AbortController()
  const signal = controller.signal
  return Promise.race([
    fetch(url, { signal }),
    new Promise((resolve, reject) => {
      setTimeout(() => {
        controller.abort()
        const err = new TimeoutError('Fetch Timeout')
        reject(err)
      }, timeout * 1000)
    }),
  ])
}

export {
  checkURL,
  checkURLByFetch,
}
