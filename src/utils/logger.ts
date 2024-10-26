import type { LogLevelNames } from 'loglevel'
import log from 'loglevel'

const colors: Record<LogLevelNames | 'silent', string> = {
  trace: '\x1B[35m', // 洋红色
  debug: '\x1B[36m', // 青色
  info: '\x1B[34m', // 蓝色
  warn: '\x1B[33m', // 黄色
  error: '\x1B[31m', // 红色
  silent: '\x1B[0m', // 重置颜色
} as const

const boldColors: Record<LogLevelNames | 'silent', string> = {
  trace: '\x1B[1;35m', // 粗体洋红色
  debug: '\x1B[1;36m', // 粗体青色
  info: '\x1B[1;34m', // 粗体蓝色
  warn: '\x1B[1;33m', // 粗体黄色
  error: '\x1B[1;31m', // 粗体红色
  silent: '\x1B[0m', // 重置颜色和样式
} as const

const bold = true

function getStyle(bold: boolean) {
  return bold ? boldColors : colors
}

const originalFactory = log.methodFactory
const style = getStyle(bold)
log.methodFactory = function (methodName, logLevel, loggerName) {
  const rawMethod = originalFactory(methodName, logLevel, loggerName)
  return function (message) {
    const color = style[methodName] || style.silent // 默认为重置颜色
    rawMethod(`${color}🥕 [${methodName}]${style.silent} ${message}`)
  }
}
log.rebuild() // Be sure to call the rebuild method in order to apply plugin.
log.enableAll()
log.setLevel(log.levels.DEBUG)

export { log }
