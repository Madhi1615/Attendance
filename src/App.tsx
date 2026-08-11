import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertCircle,
  BarChart3,
  CalendarDays,
  Check,
  ClipboardCheck,
  GraduationCap,
  Plus,
  Save,
  Settings,
  Trash2,
  Users,
  X,
} from 'lucide-react'
import {
  addStudents,
  createSchedule,
  deleteSchedule,
  deleteStudent,
  getAttendanceForDate,
  getClassSummary,
  listSchedules,
  listStudents,
  saveAttendance,
} from './lib/db'
import { isSupabaseConfigured } from './lib/supabase'
import type { ClassSummary, Department, Schedule, Student } from './types'

type View = 'attendance' | 'schedules' | 'summary'

const departments: Department[] = ['CSE', 'ECE', 'IT']
const years = [1, 2, 3, 4] as const

function localDateString() {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function scheduleTitle(schedule: Schedule) {
  return `Year ${schedule.year} · ${schedule.department} · ${schedule.label}`
}

function App() {
  const [view, setView] = useState<View>('attendance')
  const [schedules, setSchedules] = useState<Schedule[]>([])
  const [selectedScheduleId, setSelectedScheduleId] = useState('')
  const [students, setStudents] = useState<Student[]>([])
  const [date, setDate] = useState(localDateString)
  const [absentIds, setAbsentIds] = useState<Set<string>>(new Set())
  const [attendanceExists, setAttendanceExists] = useState(false)
  const [loading, setLoading] = useState(true)
  const [attendanceLoading, setAttendanceLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [summaryRefreshKey, setSummaryRefreshKey] = useState(0)

  const selectedSchedule = useMemo(
    () => schedules.find((schedule) => schedule.id === selectedScheduleId) ?? null,
    [schedules, selectedScheduleId],
  )

  const loadSchedules = useCallback(async () => {
    const rows = await listSchedules()
    setSchedules(rows)
    setSelectedScheduleId((current) => {
      if (rows.some((schedule) => schedule.id === current)) return current
      return rows[0]?.id ?? ''
    })
  }, [])

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setLoading(false)
      return
    }

    loadSchedules()
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load schedules.'))
      .finally(() => setLoading(false))
  }, [loadSchedules])

  const loadAttendance = useCallback(async () => {
    if (!selectedScheduleId) {
      setStudents([])
      setAbsentIds(new Set())
      setAttendanceExists(false)
      return
    }

    setAttendanceLoading(true)
    setError('')
    try {
      const [studentRows, records] = await Promise.all([
        listStudents(selectedScheduleId),
        getAttendanceForDate(selectedScheduleId, date),
      ])
      setStudents(studentRows)
      setAbsentIds(new Set(records.filter((record) => !record.present).map((record) => record.student_id)))
      setAttendanceExists(records.length > 0)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load attendance.')
    } finally {
      setAttendanceLoading(false)
    }
  }, [date, selectedScheduleId])

  useEffect(() => {
    if (isSupabaseConfigured) void loadAttendance()
  }, [loadAttendance])

  function toggleAbsent(studentId: string) {
    setAbsentIds((current) => {
      const next = new Set(current)
      if (next.has(studentId)) next.delete(studentId)
      else next.add(studentId)
      return next
    })
    setNotice('')
  }

  async function handleSaveAttendance() {
    if (!selectedScheduleId) return
    setSaving(true)
    setError('')
    setNotice('')
    try {
      await saveAttendance({
        scheduleId: selectedScheduleId,
        attendanceDate: date,
        students,
        absentStudentIds: absentIds,
      })
      setAttendanceExists(true)
      setSummaryRefreshKey((value) => value + 1)
      setNotice(`Attendance saved: ${students.length - absentIds.size} present, ${absentIds.size} absent.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save attendance.')
    } finally {
      setSaving(false)
    }
  }

  async function handleScheduleCreated(schedule: Schedule) {
    await loadSchedules()
    setSelectedScheduleId(schedule.id)
    setView('schedules')
    setNotice('Schedule created. Add students below.')
  }

  async function handleDeleteSchedule(scheduleId: string) {
    const schedule = schedules.find((item) => item.id === scheduleId)
    if (!schedule) return
    if (!window.confirm(`Delete ${scheduleTitle(schedule)} and all its attendance data?`)) return

    setError('')
    try {
      await deleteSchedule(scheduleId)
      await loadSchedules()
      setNotice('Schedule deleted.')
      setSummaryRefreshKey((value) => value + 1)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete schedule.')
    }
  }

  if (!isSupabaseConfigured) return <SetupRequired />

  if (loading) {
    return (
      <div className="app-shell centered">
        <div className="loader" aria-label="Loading" />
      </div>
    )
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={() => setView('attendance')} aria-label="ClassTap home">
          <span className="brand-mark"><ClipboardCheck size={22} /></span>
          <span>
            <strong>ClassTap</strong>
            <small>Attendance, without the friction.</small>
          </span>
        </button>
        <nav className="desktop-nav" aria-label="Main navigation">
          <NavButton active={view === 'attendance'} icon={<CalendarDays size={18} />} onClick={() => setView('attendance')}>Attendance</NavButton>
          <NavButton active={view === 'schedules'} icon={<Settings size={18} />} onClick={() => setView('schedules')}>Schedules</NavButton>
          <NavButton active={view === 'summary'} icon={<BarChart3 size={18} />} onClick={() => setView('summary')}>Summary</NavButton>
        </nav>
      </header>

      <main className="main-content">
        {error && <Message tone="error" text={error} onClose={() => setError('')} />}
        {notice && <Message tone="success" text={notice} onClose={() => setNotice('')} />}

        {view === 'attendance' && (
          <AttendanceView
            schedules={schedules}
            selectedScheduleId={selectedScheduleId}
            onScheduleChange={setSelectedScheduleId}
            selectedSchedule={selectedSchedule}
            date={date}
            onDateChange={setDate}
            students={students}
            absentIds={absentIds}
            onToggleAbsent={toggleAbsent}
            attendanceExists={attendanceExists}
            loading={attendanceLoading}
            saving={saving}
            onSave={handleSaveAttendance}
            onCreateSchedule={() => setView('schedules')}
          />
        )}

        {view === 'schedules' && (
          <SchedulesView
            schedules={schedules}
            selectedScheduleId={selectedScheduleId}
            onScheduleChange={setSelectedScheduleId}
            selectedSchedule={selectedSchedule}
            students={students}
            onCreated={handleScheduleCreated}
            onStudentsChanged={loadAttendance}
            onDeleteSchedule={handleDeleteSchedule}
            onError={setError}
            onNotice={setNotice}
          />
        )}

        {view === 'summary' && (
          <SummaryView
            schedules={schedules}
            selectedScheduleId={selectedScheduleId}
            onScheduleChange={setSelectedScheduleId}
            refreshKey={summaryRefreshKey}
            onError={setError}
          />
        )}
      </main>

      <nav className="mobile-nav" aria-label="Mobile navigation">
        <NavButton active={view === 'attendance'} icon={<CalendarDays size={20} />} onClick={() => setView('attendance')}>Attendance</NavButton>
        <NavButton active={view === 'schedules'} icon={<Settings size={20} />} onClick={() => setView('schedules')}>Schedules</NavButton>
        <NavButton active={view === 'summary'} icon={<BarChart3 size={20} />} onClick={() => setView('summary')}>Summary</NavButton>
      </nav>
    </div>
  )
}

function NavButton({
  active,
  icon,
  onClick,
  children,
}: {
  active: boolean
  icon: React.ReactNode
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button className={`nav-button ${active ? 'active' : ''}`} onClick={onClick}>
      {icon}
      <span>{children}</span>
    </button>
  )
}

function Message({ tone, text, onClose }: { tone: 'error' | 'success'; text: string; onClose: () => void }) {
  return (
    <div className={`message ${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      <span>{tone === 'error' ? <AlertCircle size={18} /> : <Check size={18} />}{text}</span>
      <button onClick={onClose} aria-label="Close message"><X size={17} /></button>
    </div>
  )
}

function SchedulePicker({
  schedules,
  value,
  onChange,
}: {
  schedules: Schedule[]
  value: string
  onChange: (id: string) => void
}) {
  return (
    <label className="field grow">
      <span>Schedule</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {schedules.map((schedule) => (
          <option value={schedule.id} key={schedule.id}>
            {scheduleTitle(schedule)} · {schedule.timing}
          </option>
        ))}
      </select>
    </label>
  )
}

function AttendanceView({
  schedules,
  selectedScheduleId,
  onScheduleChange,
  selectedSchedule,
  date,
  onDateChange,
  students,
  absentIds,
  onToggleAbsent,
  attendanceExists,
  loading,
  saving,
  onSave,
  onCreateSchedule,
}: {
  schedules: Schedule[]
  selectedScheduleId: string
  onScheduleChange: (id: string) => void
  selectedSchedule: Schedule | null
  date: string
  onDateChange: (date: string) => void
  students: Student[]
  absentIds: Set<string>
  onToggleAbsent: (studentId: string) => void
  attendanceExists: boolean
  loading: boolean
  saving: boolean
  onSave: () => void
  onCreateSchedule: () => void
}) {
  if (!schedules.length) {
    return (
      <EmptyState
        icon={<GraduationCap size={34} />}
        title="Create your first class schedule"
        text="Add the year, department, class label, timing and student list. Then daily attendance takes only a few taps."
        action="Create schedule"
        onAction={onCreateSchedule}
      />
    )
  }

  const present = students.length - absentIds.size

  return (
    <section>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Daily attendance</p>
          <h1>Tap only the absentees.</h1>
          <p>Everyone starts as present. Selected cards are absent.</p>
        </div>
      </div>

      <div className="toolbar card-surface">
        <SchedulePicker schedules={schedules} value={selectedScheduleId} onChange={onScheduleChange} />
        <label className="field date-field">
          <span>Date</span>
          <input type="date" value={date} onChange={(event) => onDateChange(event.target.value)} />
        </label>
      </div>

      {selectedSchedule && (
        <div className="class-strip">
          <div>
            <strong>{scheduleTitle(selectedSchedule)}</strong>
            <span>{selectedSchedule.timing}</span>
          </div>
          <div className="count-chips">
            <span className="count-chip present"><Check size={15} /> {present} present</span>
            <span className="count-chip absent"><X size={15} /> {absentIds.size} absent</span>
          </div>
        </div>
      )}

      {attendanceExists ? (
        <div className="info-line"><Check size={16} /> Attendance is already saved for this date. Your changes will update it.</div>
      ) : (
        <div className="info-line"><CalendarDays size={16} /> No saved attendance for this date. All students currently default to present.</div>
      )}

      {loading ? (
        <div className="student-grid loading-grid">
          {Array.from({ length: 8 }).map((_, index) => <div className="student-card skeleton" key={index} />)}
        </div>
      ) : students.length ? (
        <div className="student-grid" aria-label="Students">
          {students.map((student) => {
            const absent = absentIds.has(student.id)
            return (
              <button
                className={`student-card ${absent ? 'is-absent' : ''}`}
                key={student.id}
                onClick={() => onToggleAbsent(student.id)}
                aria-pressed={absent}
              >
                <span className="student-avatar">{student.name.trim().charAt(0).toUpperCase()}</span>
                <span className="student-name">{student.name}</span>
                <span className="student-status">{absent ? <><X size={16} /> Absent</> : <><Check size={16} /> Present</>}</span>
              </button>
            )
          })}
        </div>
      ) : (
        <EmptyState
          icon={<Users size={32} />}
          title="No students in this schedule"
          text="Open Schedules and paste the student names, one per line."
          action="Add students"
          onAction={onCreateSchedule}
          compact
        />
      )}

      <div className="save-dock">
        <div>
          <strong>{present}/{students.length} present</strong>
          <span>{absentIds.size ? `${absentIds.size} marked absent` : 'No absences marked'}</span>
        </div>
        <button className="primary-button save-button" onClick={onSave} disabled={saving || !students.length}>
          <Save size={19} /> {saving ? 'Saving…' : attendanceExists ? 'Update Attendance' : 'Save Attendance'}
        </button>
      </div>
    </section>
  )
}

function SchedulesView({
  schedules,
  selectedScheduleId,
  onScheduleChange,
  selectedSchedule,
  students,
  onCreated,
  onStudentsChanged,
  onDeleteSchedule,
  onError,
  onNotice,
}: {
  schedules: Schedule[]
  selectedScheduleId: string
  onScheduleChange: (id: string) => void
  selectedSchedule: Schedule | null
  students: Student[]
  onCreated: (schedule: Schedule) => Promise<void>
  onStudentsChanged: () => Promise<void>
  onDeleteSchedule: (id: string) => Promise<void>
  onError: (message: string) => void
  onNotice: (message: string) => void
}) {
  const [year, setYear] = useState<(typeof years)[number]>(1)
  const [department, setDepartment] = useState<Department>('CSE')
  const [label, setLabel] = useState('')
  const [timing, setTiming] = useState('')
  const [names, setNames] = useState('')
  const [creating, setCreating] = useState(false)
  const [adding, setAdding] = useState(false)

  async function submitSchedule(event: FormEvent) {
    event.preventDefault()
    if (!label.trim() || !timing.trim()) return
    setCreating(true)
    onError('')
    try {
      const schedule = await createSchedule({ year, department, label, timing })
      setLabel('')
      setTiming('')
      await onCreated(schedule)
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Could not create schedule.')
    } finally {
      setCreating(false)
    }
  }

  async function submitStudents(event: FormEvent) {
    event.preventDefault()
    if (!selectedScheduleId) return
    const parsed = names.split(/\r?\n|,/).map((name) => name.trim()).filter(Boolean)
    if (!parsed.length) return
    setAdding(true)
    onError('')
    try {
      await addStudents(selectedScheduleId, parsed)
      setNames('')
      await onStudentsChanged()
      onNotice(`${parsed.length} student${parsed.length === 1 ? '' : 's'} added.`)
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Could not add students.')
    } finally {
      setAdding(false)
    }
  }

  async function removeStudent(student: Student) {
    if (!window.confirm(`Remove ${student.name}? Their attendance records will also be deleted.`)) return
    onError('')
    try {
      await deleteStudent(student.id)
      await onStudentsChanged()
      onNotice(`${student.name} removed.`)
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Could not remove student.')
    }
  }

  return (
    <section>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Class setup</p>
          <h1>Schedules grow with your timetable.</h1>
          <p>Create as many year/department groups as you teach.</p>
        </div>
      </div>

      <div className="two-column">
        <form className="panel" onSubmit={submitSchedule}>
          <div className="panel-title">
            <span className="icon-bubble"><Plus size={20} /></span>
            <div><h2>New schedule</h2><p>Define the class once.</p></div>
          </div>
          <div className="form-grid two">
            <label className="field">
              <span>Year</span>
              <select value={year} onChange={(event) => setYear(Number(event.target.value) as typeof year)}>
                {years.map((item) => <option value={item} key={item}>Year {item}</option>)}
              </select>
            </label>
            <label className="field">
              <span>Department</span>
              <select value={department} onChange={(event) => setDepartment(event.target.value as Department)}>
                {departments.map((item) => <option value={item} key={item}>{item}</option>)}
              </select>
            </label>
          </div>
          <label className="field">
            <span>Class label</span>
            <input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="e.g. Data Structures – A" required />
          </label>
          <label className="field">
            <span>Timing</span>
            <input value={timing} onChange={(event) => setTiming(event.target.value)} placeholder="e.g. Mon 10:00–11:00" required />
          </label>
          <button className="primary-button full" disabled={creating}>
            <Plus size={18} /> {creating ? 'Creating…' : 'Create Schedule'}
          </button>
        </form>

        <div className="panel">
          <div className="panel-title">
            <span className="icon-bubble alt"><Users size={20} /></span>
            <div><h2>Students</h2><p>Paste names in bulk, one per line.</p></div>
          </div>

          {schedules.length ? (
            <>
              <SchedulePicker schedules={schedules} value={selectedScheduleId} onChange={onScheduleChange} />
              <form onSubmit={submitStudents}>
                <label className="field">
                  <span>Add student names</span>
                  <textarea value={names} onChange={(event) => setNames(event.target.value)} rows={7} placeholder={'Ananya Rao\nArun Kumar\nFatima Ali\nKavin Raj'} />
                </label>
                <button className="secondary-button full" disabled={adding || !names.trim()}>
                  <Plus size={18} /> {adding ? 'Adding…' : 'Add Students'}
                </button>
              </form>
            </>
          ) : (
            <div className="mini-empty">Create a schedule first, then its student list appears here.</div>
          )}
        </div>
      </div>

      {selectedSchedule && (
        <div className="panel schedule-detail">
          <div className="schedule-detail-head">
            <div>
              <p className="eyebrow">Selected schedule</p>
              <h2>{scheduleTitle(selectedSchedule)}</h2>
              <p>{selectedSchedule.timing} · {students.length} students</p>
            </div>
            <button className="danger-button" onClick={() => onDeleteSchedule(selectedSchedule.id)}>
              <Trash2 size={17} /> Delete schedule
            </button>
          </div>

          {students.length ? (
            <div className="student-list">
              {students.map((student, index) => (
                <div className="student-row" key={student.id}>
                  <span className="row-index">{index + 1}</span>
                  <span className="student-avatar small">{student.name.trim().charAt(0).toUpperCase()}</span>
                  <strong>{student.name}</strong>
                  <button className="icon-button" onClick={() => removeStudent(student)} aria-label={`Remove ${student.name}`}>
                    <Trash2 size={17} />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="mini-empty">No students yet. Paste the class list above.</div>
          )}
        </div>
      )}
    </section>
  )
}

function SummaryView({
  schedules,
  selectedScheduleId,
  onScheduleChange,
  refreshKey,
  onError,
}: {
  schedules: Schedule[]
  selectedScheduleId: string
  onScheduleChange: (id: string) => void
  refreshKey: number
  onError: (message: string) => void
}) {
  const [summary, setSummary] = useState<ClassSummary | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!selectedScheduleId) {
      setSummary(null)
      return
    }
    let active = true
    setLoading(true)
    getClassSummary(selectedScheduleId)
      .then((data) => {
        if (active) setSummary(data)
      })
      .catch((err) => onError(err instanceof Error ? err.message : 'Could not load summary.'))
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => { active = false }
  }, [onError, refreshKey, selectedScheduleId])

  if (!schedules.length) {
    return <EmptyState icon={<BarChart3 size={34} />} title="No summary yet" text="Create a schedule and save attendance first." />
  }

  return (
    <section>
      <div className="page-heading summary-heading">
        <div>
          <p className="eyebrow">Attendance summary</p>
          <h1>See who needs attention.</h1>
          <p>Percentage = days attended ÷ total class days conducted × 100.</p>
        </div>
        <div className="summary-picker"><SchedulePicker schedules={schedules} value={selectedScheduleId} onChange={onScheduleChange} /></div>
      </div>

      {loading || !summary ? (
        <div className="summary-cards"><div className="metric skeleton" /><div className="metric skeleton" /></div>
      ) : (
        <>
          <div className="summary-cards">
            <div className="metric">
              <span>Days conducted</span>
              <strong>{summary.daysConducted}</strong>
              <small>Distinct saved attendance dates</small>
            </div>
            <div className="metric">
              <span>Class average</span>
              <strong>{summary.daysConducted ? `${summary.classAverage.toFixed(1)}%` : '—'}</strong>
              <small>Average of current students</small>
            </div>
          </div>

          {summary.students.length ? (
            <div className="summary-list">
              <div className="summary-row header-row">
                <span>Student</span><span>Attended</span><span>Attendance</span>
              </div>
              {summary.students.map((student) => (
                <div className="summary-row" key={student.id}>
                  <div className="summary-student">
                    <span className="student-avatar small">{student.name.trim().charAt(0).toUpperCase()}</span>
                    <strong>{student.name}</strong>
                  </div>
                  <span>{student.attended} / {student.totalDays}</span>
                  <div className="percent-cell">
                    <strong>{student.totalDays ? `${student.percentage.toFixed(1)}%` : '—'}</strong>
                    <div className="progress"><span style={{ width: `${Math.min(100, student.percentage)}%` }} /></div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="mini-empty">No students in this schedule.</div>
          )}
        </>
      )}
    </section>
  )
}

function EmptyState({
  icon,
  title,
  text,
  action,
  onAction,
  compact = false,
}: {
  icon: React.ReactNode
  title: string
  text: string
  action?: string
  onAction?: () => void
  compact?: boolean
}) {
  return (
    <div className={`empty-state ${compact ? 'compact' : ''}`}>
      <span className="empty-icon">{icon}</span>
      <h2>{title}</h2>
      <p>{text}</p>
      {action && onAction && <button className="primary-button" onClick={onAction}><Plus size={18} /> {action}</button>}
    </div>
  )
}

function SetupRequired() {
  return (
    <div className="setup-page">
      <div className="setup-card">
        <span className="brand-mark large"><ClipboardCheck size={28} /></span>
        <p className="eyebrow">One-time setup</p>
        <h1>Connect the free Supabase database.</h1>
        <p>This project is ready, but it needs the two public Supabase environment values before it can read and save attendance.</p>
        <ol>
          <li>Run <code>supabase/schema.sql</code> in the Supabase SQL Editor.</li>
          <li>Copy <code>.env.example</code> to <code>.env.local</code>.</li>
          <li>Add your project URL and anon/publishable key, then run <code>npm run dev</code>.</li>
        </ol>
        <div className="setup-note"><AlertCircle size={18} /> No login was added by design, so the SQL policies allow public access to this app's attendance data.</div>
      </div>
    </div>
  )
}

export default App
