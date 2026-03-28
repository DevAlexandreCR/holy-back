import { Router } from 'express'
import { UserRole } from '@prisma/client'
import { requireAuth } from '../auth/auth.middleware'
import { requireRole } from '../../common/middleware/requireRole'
import {
  blockUserHandler,
  getMyRole,
  listUsersWithRoles,
  unblockUserHandler,
  updateUserRole,
} from './roles.controller'

const router = Router()

router.use(requireAuth)
router.get('/me', getMyRole)
router.patch('/users/:userId/role', requireRole([UserRole.ADMIN]), updateUserRole)
router.post('/users/:userId/block', requireRole([UserRole.ADMIN]), blockUserHandler)
router.post('/users/:userId/unblock', requireRole([UserRole.ADMIN]), unblockUserHandler)
router.get('/users', requireRole([UserRole.ADMIN, UserRole.LEAD]), listUsersWithRoles)

export default router
