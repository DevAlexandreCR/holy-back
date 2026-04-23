import { HOLYVERSO_TIMEZONE } from './holyverso.constants'

const BOGOTA_UTC_OFFSET_HOURS = 5

const pad = (value: number) => value.toString().padStart(2, '0')

export const getHolyversoLocalDateKey = (date = new Date()) => {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: HOLYVERSO_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })

  const parts = formatter.formatToParts(date)
  const year = parts.find((part) => part.type === 'year')?.value ?? '0000'
  const month = parts.find((part) => part.type === 'month')?.value ?? '00'
  const day = parts.find((part) => part.type === 'day')?.value ?? '00'

  return `${year}-${month}-${day}`
}

export const buildHolyversoScheduledDate = (
  localDate: string,
  time: string
) => {
  const [year, month, day] = localDate.split('-').map(Number)
  const [hour, minute] = time.split(':').map(Number)

  return new Date(
    Date.UTC(year, (month ?? 1) - 1, day ?? 1, (hour ?? 0) + BOGOTA_UTC_OFFSET_HOURS, minute ?? 0, 0)
  )
}

export const formatHolyversoAttemptSeed = (params: {
  localDate: string
  slotIndex: number
  retryCount: number
}) =>
  `${params.localDate}-slot-${pad(params.slotIndex + 1)}-attempt-${pad(
    params.retryCount + 1
  )}`
