import { createContext, useCallback, useEffect, useMemo, useState } from 'react'
import TopBar from './components/TopBar'
import Rail from './components/Rail'
import CourseWorkspace from './pages/CourseWorkspace'
import CoursesPage from './pages/CoursesPage'
import HomePage from './pages/HomePage'
import BookPage from './pages/BookPage'
import BankPage from './pages/BankPage'
import PaperPage from './pages/PaperPage'
import ReportPage from './pages/ReportPage'
import QAPage from './pages/QAPage'
import ModelsPage from './pages/ModelsPage'
import TasksPage from './pages/TasksPage'
import SettingsPage from './pages/SettingsPage'
import WrongPage from './pages/WrongPage'
import { api } from './api'
import type { Course } from './types'

/** 顶级视图（侧边栏） */
export type View =
  | 'home' | 'courses' | 'workspace' | 'tasks' | 'models' | 'settings'

/** 课程工作区内的功能页 */
export type SubView =
  | 'book' | 'bank' | 'paper' | 'report' | 'wrong' | 'qa'

export type NavTarget = View | SubView

const TOP_VIEWS: View[] = ['home', 'courses', 'workspace', 'tasks', 'models', 'settings']

/** 课程上下文：课程是教材 / 习题 / 测验 / 答疑等功能的一级边界（项目概念）。 */
export interface CourseCtx {
  courses: Course[]
  course: Course | null
  setCourseId: (id: string | null) => void
  refreshCourses: () => Promise<void>
}

export const CourseContext = createContext<CourseCtx>({
  courses: [], course: null, setCourseId: () => {}, refreshCourses: async () => {},
})

interface ToastMsg {
  id: number
  text: string
}

export const ToastContext = createContext<(text: string) => void>(() => {})

export default function App() {
  const [view, setView] = useState<View>('home')
  const [subView, setSubView] = useState<SubView>('book')
  const [theme, setTheme] = useState<'light' | 'dark'>(
    (localStorage.getItem('lumen-theme') as 'light' | 'dark') || 'light'
  )
  const [toasts, setToasts] = useState<ToastMsg[]>([])
  const [courses, setCourses] = useState<Course[]>([])
  const [activeCourseId, setActiveCourseId] = useState<string | null>(
    () => localStorage.getItem('lumen-course') || null
  )

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('lumen-theme', theme)
  }, [theme])

  const refreshCourses = useCallback(async () => {
    try {
      setCourses(await api.get<Course[]>('/api/v1/courses'))
    } catch { /* sidecar 未启动时静默 */ }
  }, [])

  useEffect(() => { refreshCourses() }, [refreshCourses])

  const toast = useCallback((text: string) => {
    const id = Date.now() + Math.random()
    setToasts((t) => [...t, { id, text }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2600)
  }, [])

  const toggleTheme = useCallback(() => {
    setTheme((t) => (t === 'dark' ? 'light' : 'dark'))
  }, [])

  const setCourseId = useCallback((id: string | null) => {
    setActiveCourseId(id)
    if (id) localStorage.setItem('lumen-course', id)
    else localStorage.removeItem('lumen-course')
  }, [])

  const course = useMemo(
    () => courses.find((c) => c.id === activeCourseId) ?? null,
    [courses, activeCourseId]
  )

  /** 统一导航：顶级视图直接跳转；工作区子视图进入课程工作区。 */
  const navigate = useCallback((target: NavTarget) => {
    if ((TOP_VIEWS as string[]).includes(target)) {
      setView(target as View)
    } else {
      setSubView(target as SubView)
      setView('workspace')
    }
  }, [])

  const pages: Record<View, React.ReactNode> = {
    home: <HomePage go={navigate} />,
    courses: <CoursesPage go={navigate} />,
    workspace: (
      <CourseWorkspace
        courseId={course?.id ?? ''}
        sub={subView}
        go={navigate}
      />
    ),
    tasks: <TasksPage />,
    models: <ModelsPage go={navigate} />,
    settings: <SettingsPage />,
  }

  return (
    <ToastContext.Provider value={toast}>
      <CourseContext.Provider value={{ courses, course, setCourseId, refreshCourses }}>
        <TopBar theme={theme} onToggleTheme={toggleTheme} />
        <div className="app">
          <Rail view={view} onNavigate={navigate} />
          <main className="main" key={view}>
            {pages[view]}
          </main>
        </div>
        <div className="toast-stack">
          {toasts.map((t) => (
            <div key={t.id} className="toast-item">{t.text}</div>
          ))}
        </div>
      </CourseContext.Provider>
    </ToastContext.Provider>
  )
}
