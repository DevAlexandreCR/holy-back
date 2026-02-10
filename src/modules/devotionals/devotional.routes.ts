import { Router } from 'express'
import multer from 'multer'
import { UserRole } from '@prisma/client'
import { requireAuth, optionalAuth } from '../auth/auth.middleware'
import { requireRole } from '../../common/middleware/requireRole'
import { AppError } from '../../common/errors'
import {
  addCommentHandler,
  archiveDevotionalHandler,
  createDevotionalHandler,
  deleteCommentHandler,
  deleteDevotionalHandler,
  getDevotionalHandler,
  listCommentsHandler,
  listDevotionalsHandler,
  publishDevotionalHandler,
  toggleLikeHandler,
  updateCommentHandler,
  updateDevotionalHandler,
  uploadImageHandler,
} from './devotional.controller'

const router = Router()

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp']
    if (!allowed.includes(file.mimetype)) {
      return cb(new AppError('Invalid image type', 'INVALID_IMAGE_TYPE', 400))
    }
    return cb(null, true)
  },
})

router.post(
  '/upload-image',
  requireAuth,
  requireRole([UserRole.EDITOR, UserRole.ADMIN]),
  upload.single('image'),
  uploadImageHandler
)

router.get('/', optionalAuth, listDevotionalsHandler)
router.get('/:id', optionalAuth, getDevotionalHandler)
router.post(
  '/',
  requireAuth,
  requireRole([UserRole.EDITOR, UserRole.ADMIN]),
  createDevotionalHandler
)
router.put(
  '/:id',
  requireAuth,
  requireRole([UserRole.EDITOR, UserRole.ADMIN]),
  updateDevotionalHandler
)
router.delete(
  '/:id',
  requireAuth,
  requireRole([UserRole.EDITOR, UserRole.ADMIN]),
  deleteDevotionalHandler
)
router.post(
  '/:id/publish',
  requireAuth,
  requireRole([UserRole.EDITOR, UserRole.ADMIN]),
  publishDevotionalHandler
)
router.post(
  '/:id/archive',
  requireAuth,
  requireRole([UserRole.EDITOR, UserRole.ADMIN]),
  archiveDevotionalHandler
)
router.post('/:id/like', requireAuth, toggleLikeHandler)
router.get('/:id/comments', optionalAuth, listCommentsHandler)
router.post('/:id/comments', requireAuth, addCommentHandler)
router.put('/:id/comments/:commentId', requireAuth, updateCommentHandler)
router.delete('/:id/comments/:commentId', requireAuth, deleteCommentHandler)

export default router
