import { describe, it, expect } from 'vitest'
import { baseName, parentPath, pathSegments } from '../projectPaths'

describe('baseName', () => {
  it('取 win / posix 路径的末段', () => {
    expect(baseName('C:\\work\\nerve-agent')).toBe('nerve-agent')
    expect(baseName('/Users/arch/nerve-agent')).toBe('nerve-agent')
  })

  it('忽略结尾斜杠，盘根保留盘符', () => {
    expect(baseName('C:\\work\\nerve-agent\\')).toBe('nerve-agent')
    expect(baseName('/Users/arch/')).toBe('arch')
    expect(baseName('C:\\')).toBe('C:')
  })
})

describe('parentPath', () => {
  it('回到上一级', () => {
    expect(parentPath('C:\\work\\nerve-agent')).toBe('C:\\work')
    expect(parentPath('/Users/arch/code')).toBe('/Users/arch')
  })

  it('盘根与文件系统根没有上一级', () => {
    expect(parentPath('C:\\')).toBeNull()
    expect(parentPath('/')).toBeNull()
  })

  it('盘符下一级回落到带分隔符的盘根', () => {
    expect(parentPath('C:\\Users')).toBe('C:\\')
    expect(parentPath('/Users')).toBe('/')
  })

  it('相对路径不猜上一级', () => {
    expect(parentPath('nerve-agent')).toBeNull()
  })

  it('与 baseName 互逆：parentPath + baseName 还原原路径', () => {
    const path = 'G:\\worktree\\nerve-agent'
    expect(`${parentPath(path)}\\${baseName(path)}`).toBe(path)
  })
})

describe('pathSegments', () => {
  it('win：逐级累积出可跳转的完整路径', () => {
    expect(pathSegments('C:\\work\\nerve-agent')).toEqual([
      { name: 'C:', path: 'C:\\' },
      { name: 'work', path: 'C:\\work' },
      { name: 'nerve-agent', path: 'C:\\work\\nerve-agent' },
    ])
  })

  it('posix：首段带根斜杠', () => {
    expect(pathSegments('/Users/arch')).toEqual([
      { name: 'Users', path: '/Users' },
      { name: 'arch', path: '/Users/arch' },
    ])
  })

  it('结尾斜杠不产生空段', () => {
    expect(pathSegments('C:\\work\\').map((s) => s.name)).toEqual(['C:', 'work'])
  })
})
