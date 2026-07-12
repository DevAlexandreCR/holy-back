import { Router } from 'express'
import multer from 'multer'
import { requireAuth, optionalAuth } from '../auth/auth.middleware'
import { AppError } from '../../common/errors'
import { requireUserCapability } from '../../common/middleware/requireUserCapability'
import {
  addCommentHandler,
  archiveDevotionalHandler,
  celebrateMilestoneHandler,
  createDevotionalHandler,
  deleteCommentHandler,
  deleteDevotionalHandler,
  getDevotionalHandler,
  getDevotionalAudioConfigHandler,
  getFeedHeaderHandler,
  listCommentsHandler,
  listDevotionalsHandler,
  listFeedHandler,
  listSavedDevotionalsHandler,
  publishDevotionalHandler,
  readCompleteHandler,
  recordFeedEventsHandler,
  reportDevotionalHandler,
  requestDevotionalAudioHandler,
  saveDevotionalHandler,
  shareDevotionalHandler,
  toggleLikeHandler,
  unsaveDevotionalHandler,
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

router.get('/feed', requireAuth, listFeedHandler)
router.get('/feed/header', requireAuth, getFeedHeaderHandler)
router.post('/feed/events', requireAuth, recordFeedEventsHandler)
router.post(
  '/streak/milestones/:milestone/celebrate',
  requireAuth,
  celebrateMilestoneHandler
)
router.get('/audio/config', requireAuth, getDevotionalAudioConfigHandler)
router.post('/upload-image', requireAuth, upload.single('image'), uploadImageHandler)

router.get('/', requireAuth, listDevotionalsHandler)
router.get('/saved', requireAuth, listSavedDevotionalsHandler)
router.post('/', requireAuth, requireUserCapability('DEVOTIONAL_CREATE'), createDevotionalHandler)
router.get('/:id', optionalAuth, getDevotionalHandler)
router.put('/:id', requireAuth, requireUserCapability('DEVOTIONAL_EDIT'), updateDevotionalHandler)
router.delete('/:id', requireAuth, deleteDevotionalHandler)
router.post('/:id/publish', requireAuth, requireUserCapability('DEVOTIONAL_PUBLISH'), publishDevotionalHandler)
router.post('/:id/archive', requireAuth, archiveDevotionalHandler)
router.post('/:id/like', requireAuth, toggleLikeHandler)
router.post('/:id/save', requireAuth, saveDevotionalHandler)
router.delete('/:id/save', requireAuth, unsaveDevotionalHandler)
router.post('/:id/share', requireAuth, shareDevotionalHandler)
router.post('/:id/read-complete', requireAuth, readCompleteHandler)
router.post('/:id/report', requireAuth, reportDevotionalHandler)
router.post('/:id/audio', requireAuth, requestDevotionalAudioHandler)
router.get('/:id/comments', optionalAuth, listCommentsHandler)
router.post('/:id/comments', requireAuth, requireUserCapability('COMMENT_CREATE'), addCommentHandler)
router.put('/:id/comments/:commentId', requireAuth, requireUserCapability('COMMENT_EDIT'), updateCommentHandler)
router.delete('/:id/comments/:commentId', requireAuth, requireUserCapability('COMMENT_DELETE'), deleteCommentHandler)

export default router
