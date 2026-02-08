import { Router } from 'express'
import { UserRole } from '@prisma/client'
import { requireAuth } from '../auth/auth.middleware'
import { requireRole } from '../../common/middleware/requireRole'
import { getMyRole, listUsersWithRoles, updateUserRole } from './roles.controller'

const router = Router()

router.use(requireAuth)
router.get('/me', getMyRole)
router.patch('/users/:userId/role', requireRole([UserRole.ADMIN]), updateUserRole)
router.get('/users', requireRole([UserRole.ADMIN, UserRole.LEAD]), listUsersWithRoles)

export default router
