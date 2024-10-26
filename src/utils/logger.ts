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

const originalFactory = log.methodFactory
log.methodFactory = function (methodName, logLevel, loggerName) {
  const rawMethod = originalFactory(methodName, logLevel, loggerName)
  return function (message) {
    const color = colors[methodName] || colors.silent // 默认为重置颜色
    rawMethod(`${color}🥕 [${methodName}]${colors.silent} ${message}`)
  }
}
log.rebuild() // Be sure to call the rebuild method in order to apply plugin.
log.enableAll()
log.setLevel(log.levels.DEBUG)

export { log }
