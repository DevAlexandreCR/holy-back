import { Router } from 'express'
import multer from 'multer'
import { requireAuth } from '../auth/auth.middleware'
import { AppError } from '../../common/errors'
import {
  followCreatorHandler,
  getCreatorProfileHandler,
  listCreatorDevotionalsHandler,
  unfollowCreatorHandler,
  updateMyCreatorProfileHandler,
  uploadCreatorAvatarHandler,
} from './userProfile.controller'

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

router.use(requireAuth)
router.put('/me/creator-profile', updateMyCreatorProfileHandler)
router.post(
  '/me/upload-avatar',
  upload.single('image'),
  uploadCreatorAvatarHandler
)
router.post('/:id/follow', followCreatorHandler)
router.delete('/:id/follow', unfollowCreatorHandler)
router.get('/:id/profile', getCreatorProfileHandler)
router.get('/:id/devotionals', listCreatorDevotionalsHandler)

export default router
