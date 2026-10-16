import type { NavTarget, SubView } from '../App'
import BookPage from './BookPage'
import BankPage from './BankPage'
import PaperPage from './PaperPage'
import ReportPage from './ReportPage'
import QAPage from './QAPage'
import WrongPage from './WrongPage'

interface Props {
  courseId: string
  sub: SubView
  go: (v: NavTarget) => void
}

const TABS: { key: SubView; ico: string; label: string }[] = [
  { key: 'book', ico: '📖', label: '教材' },
  { key: 'bank', ico: '🗂️', label: '题库' },
  { key: 'paper', ico: '📝', label: '试卷' },
  { key: 'report', ico: '📊', label: '成绩单' },
  { key: 'wrong', ico: '📕', label: '错题本' },
  { key: 'qa', ico: '💬', label: '答疑' },
]

export default function CourseWorkspace({ courseId, sub, go }: Props) {
  if (!courseId) {
    return (
      <div className="card empty">
        请在左侧「我的课程」中选择课程<br /><br />
        <button className="btn btn-primary" onClick={() => go('courses')}>返回我的课程</button>
      </div>
    )
  }

  const render = () => {
    switch (sub) {
      case 'book': return <BookPage go={go} courseId={courseId} />
      case 'bank': return <BankPage go={go} courseId={courseId} />
      case 'paper': return <PaperPage go={go} courseId={courseId} />
      case 'report': return <ReportPage go={go} courseId={courseId} />
      case 'wrong': return <WrongPage go={go} courseId={courseId} />
      case 'qa': return <QAPage courseId={courseId} />
    }
  }

  return (
    <>
      <div className="ws-tabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            className={`ws-tab ${sub === t.key ? 'active' : ''}`}
            onClick={() => go(t.key)}
          >
            <span>{t.ico}</span> {t.label}
          </button>
        ))}
      </div>
      {render()}
    </>
  )
}
