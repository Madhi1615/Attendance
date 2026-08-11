export type Department = 'CSE' | 'ECE' | 'IT'

export interface Schedule {
  id: string
  year: 1 | 2 | 3 | 4
  department: Department
  label: string
  timing: string
  created_at: string
}

export interface Student {
  id: string
  schedule_id: string
  name: string
  display_order: number
  created_at: string
}

export interface AttendanceRecord {
  id: string
  schedule_id: string
  student_id: string
  attendance_date: string
  present: boolean
  created_at: string
  updated_at: string
}

export interface StudentSummary extends Student {
  attended: number
  totalDays: number
  percentage: number
}

export interface ClassSummary {
  daysConducted: number
  classAverage: number
  students: StudentSummary[]
}
