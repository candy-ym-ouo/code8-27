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

    // 整个导出在单一 REPEATABLE READ 快照内完成，
    // 计数与行内容、书目与痕迹都来自同一时刻，与存量口径一致。
    const data = await prisma.$transaction(
      async (tx) => {
        const [booksCount, dogEarsCount, annotationsCount, rereadCount, reflectionsCount, eventsCount] =
          await Promise.all([
            tx.book.count({ where: { userId, ...filter } }),
            tx.dogEar.count({ where: { userId, ...filter } }),
            tx.annotation.count({ where: { userId, ...filter } }),
            tx.rereadMark.count({ where: { userId, ...filter } }),
            tx.completionReflection.count({ where: { userId, ...filter } }),
            tx.activityEvent.count({ where: { userId } })
          ]);
        const totalRows =
          booksCount + dogEarsCount + annotationsCount + rereadCount + reflectionsCount + eventsCount;
        if (totalRows > env.EXPORT_MAX_ROWS) {
          throw new AppError(413, 'EXPORT_TOO_LARGE', `导出数据超过 ${env.EXPORT_MAX_ROWS} 行限制`);
        }

        const [user, books, dogEars, annotations, rereadMarks, reflections, activityEvents] = await Promise.all([
          tx.user.findUniqueOrThrow({ where: { id: userId } }),
          tx.book.findMany({ where: { userId, ...filter }, orderBy: { createdAt: 'asc' } }),
          tx.dogEar.findMany({ where: { userId, ...filter }, orderBy: { createdAt: 'asc' } }),
          tx.annotation.findMany({ where: { userId, ...filter }, orderBy: { createdAt: 'asc' } }),
          tx.rereadMark.findMany({ where: { userId, ...filter }, orderBy: { createdAt: 'asc' } }),
          tx.completionReflection.findMany({ where: { userId, ...filter }, orderBy: { createdAt: 'asc' } }),
          tx.activityEvent.findMany({ where: { userId }, orderBy: { occurredAt: 'asc' } })
        ]);
        return { user, books, dogEars, annotations, rereadMarks, reflections, activityEvents };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }
    );

    const exportedAt = new Date();
    const payload = {
      schemaVersion: 1,
      exportedAt: exportedAt.toISOString(),
      includeDeleted,
      user: {
        id: data.user.id,
        email: data.user.email,
        createdAt: data.user.createdAt,
        updatedAt: data.user.updatedAt
      },
      books: data.books,
      dogEars: data.dogEars,
      annotations: data.annotations,
      rereadMarks: data.rereadMarks,
      reflections: data.reflections,
      activityEvents: data.activityEvents
    };
    const date = exportedAt.toISOString().slice(0, 10);
    reply
      .header('Content-Type', 'application/json; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="paper-book-traces-${date}.json"`);
    return reply.send(JSON.stringify(payload, null, 2));
  });
};
