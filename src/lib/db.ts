import { supabase } from './supabase'
import type {
  AttendanceRecord,
  ClassSummary,
  Department,
  MonthlyReport,
  Schedule,
  Student,
} from '../types'

function client() {
  if (!supabase) {
    throw new Error('Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.')
  }
  return supabase
}

export async function listSchedules(): Promise<Schedule[]> {
  const { data, error } = await client()
    .from('schedules')
    .select('*')
    .order('year')
    .order('department')
    .order('label')

  if (error) throw error
  return (data ?? []) as Schedule[]
}

export async function createSchedule(input: {
  year: 1 | 2 | 3 | 4
  department: Department
  label: string
  timing: string
}): Promise<Schedule> {
  const { data, error } = await client()
    .from('schedules')
    .insert({
      year: input.year,
      department: input.department,
      label: input.label.trim(),
      timing: input.timing.trim(),
    })
    .select('*')
    .single()

  if (error) throw error
  return data as Schedule
}

export async function deleteSchedule(scheduleId: string) {
  const { error } = await client().from('schedules').delete().eq('id', scheduleId)
  if (error) throw error
}

export async function listStudents(scheduleId: string): Promise<Student[]> {
  const { data, error } = await client()
    .from('students')
    .select('*')
    .eq('schedule_id', scheduleId)
    .order('display_order')
    .order('name')

  if (error) throw error
  return (data ?? []) as Student[]
}

export async function addStudents(scheduleId: string, names: string[]): Promise<Student[]> {
  const cleanNames = names.map((name) => name.trim()).filter(Boolean)
  if (!cleanNames.length) return []

  const { data: existing, error: existingError } = await client()
    .from('students')
    .select('display_order')
    .eq('schedule_id', scheduleId)
    .order('display_order', { ascending: false })
    .limit(1)

  if (existingError) throw existingError
  const startAt = ((existing?.[0]?.display_order as number | undefined) ?? -1) + 1

  const rows = cleanNames.map((name, index) => ({
    schedule_id: scheduleId,
    name,
    display_order: startAt + index,
  }))

  const { data, error } = await client().from('students').insert(rows).select('*')
  if (error) throw error
  return (data ?? []) as Student[]
}

export async function deleteStudent(studentId: string) {
  const { error } = await client().from('students').delete().eq('id', studentId)
  if (error) throw error
}

export async function getAttendanceForDate(
  scheduleId: string,
  attendanceDate: string,
): Promise<AttendanceRecord[]> {
  const { data, error } = await client()
    .from('attendance_records')
    .select('*')
    .eq('schedule_id', scheduleId)
    .eq('attendance_date', attendanceDate)

  if (error) throw error
  return (data ?? []) as AttendanceRecord[]
}

export async function saveAttendance(input: {
  scheduleId: string
  attendanceDate: string
  students: Student[]
  absentStudentIds: Set<string>
}) {
  if (!input.students.length) {
    throw new Error('Add at least one student before saving attendance.')
  }

  const rows = input.students.map((student) => ({
    schedule_id: input.scheduleId,
    student_id: student.id,
    attendance_date: input.attendanceDate,
    present: !input.absentStudentIds.has(student.id),
    updated_at: new Date().toISOString(),
  }))

  const { error } = await client()
    .from('attendance_records')
    .upsert(rows, { onConflict: 'schedule_id,student_id,attendance_date' })

  if (error) throw error
}

export async function getClassSummary(scheduleId: string): Promise<ClassSummary> {
  const [students, recordsResult] = await Promise.all([
    listStudents(scheduleId),
    client()
      .from('attendance_records')
      .select('student_id, attendance_date, present')
      .eq('schedule_id', scheduleId),
  ])

  if (recordsResult.error) throw recordsResult.error
  const records = recordsResult.data ?? []
  const dates = new Set(records.map((record) => record.attendance_date as string))
  const daysConducted = dates.size

  const attendedByStudent = new Map<string, number>()
  for (const record of records) {
    if (record.present) {
      const studentId = record.student_id as string
      attendedByStudent.set(studentId, (attendedByStudent.get(studentId) ?? 0) + 1)
    }
  }

  const summaryStudents = students.map((student) => {
    const attended = attendedByStudent.get(student.id) ?? 0
    const percentage = daysConducted === 0 ? 0 : (attended / daysConducted) * 100
    return { ...student, attended, totalDays: daysConducted, percentage }
  })

  const classAverage = summaryStudents.length
    ? summaryStudents.reduce((sum, student) => sum + student.percentage, 0) / summaryStudents.length
    : 0

  return {
    daysConducted,
    classAverage,
    students: summaryStudents,
  }
}

export async function getMonthlyReport(
  scheduleId: string,
  year: number,
  month: number,
): Promise<MonthlyReport> {
  const startDate = `${year}-${String(month).padStart(2, '0')}-01`
  const lastDay = new Date(year, month, 0).getDate()
  const endDate = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`

  const [students, recordsResult] = await Promise.all([
    listStudents(scheduleId),
    client()
      .from('attendance_records')
      .select('student_id, attendance_date, present')
      .eq('schedule_id', scheduleId)
      .gte('attendance_date', startDate)
      .lte('attendance_date', endDate),
  ])

  if (recordsResult.error) throw recordsResult.error
  const records = recordsResult.data ?? []

  const dayCounts = new Map<string, { present: number; absent: number }>()
  const attendedByStudent = new Map<string, number>()

  for (const record of records) {
    const date = record.attendance_date as string
    const entry = dayCounts.get(date) ?? { present: 0, absent: 0 }
    if (record.present) {
      entry.present += 1
      const studentId = record.student_id as string
      attendedByStudent.set(studentId, (attendedByStudent.get(studentId) ?? 0) + 1)
    } else {
      entry.absent += 1
    }
    dayCounts.set(date, entry)
  }

  const days = Array.from(dayCounts.entries())
    .map(([date, counts]) => ({ date, present: counts.present, absent: counts.absent, total: counts.present + counts.absent }))
    .sort((a, b) => a.date.localeCompare(b.date))

  const daysConducted = days.length

  const summaryStudents = students.map((student) => {
    const attended = attendedByStudent.get(student.id) ?? 0
    const percentage = daysConducted === 0 ? 0 : (attended / daysConducted) * 100
    return { ...student, attended, totalDays: daysConducted, percentage }
  })

  const classAverage = summaryStudents.length
    ? summaryStudents.reduce((sum, student) => sum + student.percentage, 0) / summaryStudents.length
    : 0

  return {
    daysConducted,
    classAverage,
    students: summaryStudents,
    days,
  }
}
