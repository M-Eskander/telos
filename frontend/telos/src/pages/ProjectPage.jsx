import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, list } from '../api.js';
import { useAuth } from '../auth.jsx';
import { can } from '../permissions.js';
import { Empty, ErrorNote, Loading, PageTitle, Progress, tabKeyDown, useAsync, useAsyncIf } from '../ui.jsx';
import Attention from './Attention.jsx';
import Tasks from './Tasks.jsx';
import Timeline from './Timeline.jsx';
import Team from './Team.jsx';
import ProjectSettings from './ProjectSettings.jsx';
import ProjectSheet from './ProjectSheet.jsx';
import ProjectContracts from './ProjectContracts.jsx';
import ProjectMeetings from './ProjectMeetings.jsx';
import ProjectWork from './ProjectWork.jsx';

const TAB_KEYS = ['tasks', 'attention', 'timeline', 'team', 'work', 'sheet', 'contracts', 'meetings', 'settings'];

export default function ProjectPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const requestedTab = TAB_KEYS.includes(params.get('tab')) ? params.get('tab') : 'tasks';

  // Each resource loads independently so one 403 doesn't blank the page, and
  // only the section on screen is fetched.
  const project = useAsync(() => api(`/projects/${id}`), [id]);
  const p = project.data?.project || null;
  const allowed = (permission) => user?.isOwner === true || (p ? can(p, permission) : false);

  const canManageProject = allowed('update:project');
  const canDeleteProject = allowed('delete:project');
  const canManageTasks = allowed('manage:task');
  const canManageTeam = allowed('manage_team:project');
  const canReadTeam = allowed('read:team');
  const canReadTimeline = allowed('read:task') &&
    (user?.isOwner === true || !allowed('view_own:task'));

  const tabs = [
    ...(allowed('read:task') ? [['tasks', 'Tasks']] : []),
    ...(allowed('read:task') ? [['attention', 'Attention']] : []),
    ...(canReadTimeline ? [['timeline', 'Timeline']] : []),
    ...(canReadTeam ? [['team', 'Team']] : []),
    ...(canReadTeam ? [['work', 'Work']] : []),
    ...(allowed('read:project') ? [['sheet', 'Sheet']] : []),
    ...(allowed('read:project') ? [['contracts', 'Contracts']] : []),
    ...(allowed('read:project') ? [['meetings', 'Meetings']] : []),
    ...((canManageProject || canDeleteProject) ? [['settings', 'Settings']] : []),
  ];
  const activeTab = tabs.length === 0
    ? null
    : (tabs.some(([key]) => key === requestedTab) ? requestedTab : tabs[0][0]);
  const tabKeys = tabs.map(([key]) => key);
  const selectTab = (key) => setParams({ tab: key });

  // The tab badge needs the count before the tab is opened, so this summary
  // loads as soon as the project is known.
  const attention = useAsyncIf(
    () => api(`/projects/${id}/attention`),
    [id],
    Boolean(p) && allowed('read:task')
  );
  const attentionCount = attention.data?.attention
    ? Object.values(attention.data.attention)
      .filter((list) => Array.isArray(list))
      .reduce((sum, list) => sum + list.length, 0)
    : null;

  const tasks = useAsyncIf(
    () => api(`/projects/${id}/tasks`),
    [id],
    activeTab === 'tasks'
  );
  const members = useAsyncIf(
    () => api(`/projects/${id}/members`),
    [id],
    activeTab === 'tasks' || activeTab === 'team' || activeTab === 'meetings'
  );
  const departments = useAsyncIf(
    () => api(`/projects/${id}/departments`),
    [id],
    activeTab === 'team'
  );
  const timeline = useAsyncIf(
    () => api(`/projects/${id}/timeline`),
    [id],
    activeTab === 'timeline'
  );

  // After task changes, refresh tasks, timeline, attention and the project's progress.
  const refreshWork = () => { tasks.reload(); timeline.reload(); attention.reload(); project.reload(); };
  const refreshTeam = () => { members.reload(); departments.reload(); tasks.reload(); timeline.reload(); attention.reload(); };

  if (project.loading && !project.data) return <Loading />;
  if (project.error) return (<><Link to="/" className="back">← Projects</Link><ErrorNote error={project.error} retry={project.reload} /></>);

  return (
    <>
      <PageTitle>{p.name}</PageTitle>
      <Link to="/" className="back">← Projects</Link>
      <div className="page-head">
        <div className="page-title">
          <h1>{p.name}</h1>
          {p.description && <p className="muted clamp-2">{p.description}</p>}
        </div>
        <div className="page-actions">
          <div className="wide-progress"><Progress value={p.progress} /></div>
        </div>
      </div>
      <div className="tabs" role="tablist" aria-label="Project sections">
        {tabs.map(([key, label]) => (
          <button
            key={key}
            id={'project-tab-' + key}
            role="tab"
            aria-controls="project-panel"
            aria-selected={activeTab === key}
            tabIndex={activeTab === key ? 0 : -1}
            className={activeTab === key ? 'on' : ''}
            onClick={() => selectTab(key)}
            onKeyDown={(event) => tabKeyDown(event, tabKeys, activeTab, selectTab)}
          >
            {label}
            {key === 'attention' && attentionCount > 0 && <span className="tab-count">{attentionCount}</span>}
          </button>
        ))}
      </div>
      {!activeTab ? <Empty title="No visible sections" mood="sad" /> : (
      <div id="project-panel" role="tabpanel" aria-labelledby={'project-tab-' + activeTab} tabIndex={0}>
      {activeTab === 'attention' && <Attention projectId={id} state={attention} />}
      {activeTab === 'tasks' && (
        <Tasks
          projectId={id}
          state={tasks}
          members={list(members.data, 'members')}
          onChange={refreshWork}
          onEdit={() => tasks.reload()}
          focusTask={params.get('task')}
          canCreate={allowed('create:task')}
          canUpdate={allowed('update:task')}
          canManageTasks={canManageTasks}
          canDelete={allowed('delete:task')}
        />
      )}
      {activeTab === 'timeline' && (
        <Timeline
          state={timeline}
          projectId={id}
          onChange={refreshWork}
          canEdit={allowed('update:task')}
        />
      )}
      {activeTab === 'team' && <Team projectId={id} members={members} departments={departments} onChange={refreshTeam} canManage={canManageTeam} />}
      {activeTab === 'work' && <ProjectWork projectId={id} />}
      {activeTab === 'sheet' && <ProjectSheet projectId={id} canEdit={canManageTeam} />}
      {activeTab === 'contracts' && <ProjectContracts projectId={id} canEdit={canManageTeam} />}
      {activeTab === 'meetings' && (
        <ProjectMeetings projectId={id} members={members} canManage={canManageTeam} />
      )}
      {activeTab === 'settings' && <ProjectSettings project={p} onSaved={project.reload} canEdit={canManageProject} canDelete={canDeleteProject} />}
      </div>
      )}
    </>
  );
}
