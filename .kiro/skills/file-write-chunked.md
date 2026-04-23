---
name: file-write-chunked
description: 分段写入大文件，避免单次写入过大导致 aborted 错误
---

# Skill: 分段写入（Chunked File Write）

## 触发条件

任何需要创建或覆盖文件，且预估内容超过 50 行时，自动启用本 skill。

## 核心规则

- 单次 `fsWrite` 内容 **不超过 50 行**
- 超出部分使用 `fsAppend` 逐段追加，每段 **不超过 50 行**
- 按逻辑边界分段（章节、函数、结构体），不在中间截断

## 执行模板

```
Step 1: fsWrite(path, lines_1_to_50)
Step 2: fsAppend(path, lines_51_to_100)
Step 3: fsAppend(path, lines_101_to_150)
...
```

## 禁止行为

- 禁止单次 fsWrite 超过 50 行
- 禁止用 bash echo/cat 重定向写大文件
