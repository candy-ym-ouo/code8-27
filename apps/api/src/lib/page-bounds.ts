import { Prisma } from '@prisma/client';

type Tx = Prisma.TransactionClient;

/**
 * 在事务内锁定书目行。
 * 总页数调整、痕迹写入与撤销恢复都先取这把锁，
 * 保证页码边界的复算与写入在同一个临界区内完成。
 */
export async function lockBookForUpdate(tx: Tx, bookId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM books WHERE id = ${bookId}::uuid FOR UPDATE`;
}

/**
 * 复算书目下活跃痕迹的最大页码。
 * 软删除记录不参与边界；已删除痕迹在恢复时会重新校验页码上界。
 */
export async function maximumActiveTracePage(tx: Tx, userId: string, bookId: string): Promise<number> {
  const [dogEar, annotation, reread] = await Promise.all([
    tx.dogEar.aggregate({ where: { userId, bookId, deletedAt: null }, _max: { pageNumber: true } }),
    tx.annotation.aggregate({ where: { userId, bookId, deletedAt: null }, _max: { endPage: true } }),
    tx.rereadMark.aggregate({ where: { userId, bookId, deletedAt: null }, _max: { pageNumber: true } })
  ]);
  return Math.max(
    dogEar._max.pageNumber ?? 0,
    annotation._max.endPage ?? 0,
    reread._max.pageNumber ?? 0
  );
}
