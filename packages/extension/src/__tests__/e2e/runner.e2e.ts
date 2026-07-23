/**
 * e2e 运行入口：@vscode/test-electron 要求 extensionTestsPath 指向的模块
 * 导出 run(): Promise<void>。这里用一个最小 runner（顺序执行、单用例超时、
 * 汇总结果），不引入 mocha 依赖。
 */
import { tests } from './suite.e2e.js'

const PER_TEST_TIMEOUT_MS = 60_000

async function withTimeout(
  name: string,
  fn: () => Promise<void>,
): Promise<void> {
  let timer: NodeJS.Timeout | undefined
  try {
    await Promise.race([
      fn(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(new Error(`用例超时（>${PER_TEST_TIMEOUT_MS / 1000}s）`)),
          PER_TEST_TIMEOUT_MS,
        )
      }),
    ])
  } catch (err) {
    throw new Error(`${name}: ${(err as Error).message}`)
  } finally {
    clearTimeout(timer)
  }
}

export async function run(): Promise<void> {
  console.log(`[e2e] 共 ${tests.length} 个用例`)
  let failed = 0
  for (const [name, fn] of tests) {
    const start = Date.now()
    try {
      await withTimeout(name, fn)
      console.log(`[e2e] PASS ${name} (${Date.now() - start}ms)`)
    } catch (err) {
      failed += 1
      console.error(`[e2e] FAIL ${(err as Error).message}`)
    }
  }
  console.log(`[e2e] 结果：${tests.length - failed} 通过 / ${failed} 失败`)
  if (failed > 0) throw new Error(`${failed} 个 e2e 用例失败`)
}
