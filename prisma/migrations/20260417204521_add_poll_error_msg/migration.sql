-- AlterTable: 添加 pollErrorMsg 字段，用于记录我方轮询网络异常（不代表任务失败）
ALTER TABLE "Task" ADD COLUMN "pollErrorMsg" TEXT;
