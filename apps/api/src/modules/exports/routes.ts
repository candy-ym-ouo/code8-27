import type { FastifyPluginAsync } from 'fastify';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../lib/errors.js';
import { currentUser, requireAuth } from '../../lib/auth.js';
import { env } from '../../config/env.js';

function notDeletedFilter(includeDeleted: boolean) {
  return includeDeleted ? {} : { deletedAt: null };
}

export const exportRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth);

  app.get('/exports/me', async (request, reply) => {
    const userId = currentUser(request).id;
    const query = request.query as Record<string, unknown>;
    const includeDeleted = String(query.includeDeleted ?? 'false').toLowerCase() === 'true';
    const filter = notDeletedFilter(includeDeleted);

    // 行数上限检查与导出内容必须来自同一快照，
    // 否则并发写入会让“检查过的存量”与“实际导出的口径”分叉。
    const snapshot = await prisma.$transaction(
      async (tx) => {
        const booksCount = await tx.book.count({ where: { userId, ...filter } });
        const dogEarsCount = await tx.dogEar.count({ where: { userId, ...filter } });
        const annotationsCount = await tx.annotation.count({ where: { userId, ...filter } });
        const rereadCount = await tx.rereadMark.count({ where: { userId, ...filter } });
        const reflectionsCount = await tx.completionReflection.count({ where: { userId, ...filter } });
        const eventsCount = await tx.activityEvent.count({ where: { userId } });
        const totalRows =
          booksCount + dogEarsCount + annotationsCount + rereadCount + reflectionsCount + eventsCount;
        if (totalRows > env.EXPORT_MAX_ROWS) {
          throw new AppError(413, 'EXPORT_TOO_LARGE', `导出数据超过 ${env.EXPORT_MAX_ROWS} 行限制`);
        }

        const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
        const books = await tx.book.findMany({ where: { userId, ...filter }, orderBy: { createdAt: 'asc' } });
        const dogEars = await tx.dogEar.findMany({ where: { userId, ...filter }, orderBy: { createdAt: 'asc' } });
        const annotations = await tx.annotation.findMany({
          where: { userId, ...filter },
          orderBy: { createdAt: 'asc' }
        });
        const rereadMarks = await tx.rereadMark.findMany({
          where: { userId, ...filter },
          orderBy: { createdAt: 'asc' }
        });
        const reflections = await tx.completionReflection.findMany({
          where: { userId, ...filter },
          orderBy: { createdAt: 'asc' }
        });
        const activityEvents = await tx.activityEvent.findMany({
          where: { userId },
          orderBy: { occurredAt: 'asc' }
        });
        return { user, books, dogEars, annotations, rereadMarks, reflections, activityEvents };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30_000 }
    );

    const exportedAt = new Date();
    const payload = {
      schemaVersion: 1,
      exportedAt: exportedAt.toISOString(),
      includeDeleted,
      user: {
        id: snapshot.user.id,
        email: snapshot.user.email,
        createdAt: snapshot.user.createdAt,
        updatedAt: snapshot.user.updatedAt
      },
      books: snapshot.books,
      dogEars: snapshot.dogEars,
      annotations: snapshot.annotations,
      rereadMarks: snapshot.rereadMarks,
      reflections: snapshot.reflections,
      activityEvents: snapshot.activityEvents
    };
    const date = exportedAt.toISOString().slice(0, 10);
    reply
      .header('Content-Type', 'application/json; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="paper-book-traces-${date}.json"`);
    return reply.send(JSON.stringify(payload, null, 2));
  });
};
