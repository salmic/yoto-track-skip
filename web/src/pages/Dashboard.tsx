import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, type ActivityEntry, type DeviceStatus, type SkipProfile } from '../api'

interface DashboardProps {
  onRefreshAuth: () => Promise<unknown>
  serviceRunning: boolean
}

export function Dashboard({ onRefreshAuth, serviceRunning }: DashboardProps) {
  const [profiles, setProfiles] = useState<SkipProfile[]>([])
  const [devices, setDevices] = useState<DeviceStatus[]>([])
  const [activity, setActivity] = useState<ActivityEntry[]>([])
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    setError(null)
    try {
      const [profileResult, deviceResult, activityResult] = await Promise.all([
        api.getProfiles(),
        api.getDevices(),
        api.getActivity()
      ])
      setProfiles(profileResult.profiles)
      setDevices(deviceResult.devices)
      setActivity(activityResult.activity)
      await onRefreshAuth()
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load dashboard')
    }
  }

  useEffect(() => {
    void load()
    const interval = window.setInterval(() => void load(), 10000)
    return () => window.clearInterval(interval)
  }, [])

  const toggleProfile = async (cardId: string, enabled: boolean) => {
    const result = await api.toggleProfile(cardId, enabled)
    setProfiles((current) => current.map((profile) => (profile.cardId === cardId ? result.profile : profile)))
  }

  const deleteProfile = async (cardId: string) => {
    await api.deleteProfile(cardId)
    setProfiles((current) => current.filter((profile) => profile.cardId !== cardId))
  }

  return (
    <>
      <div className="card">
        <h2>Players</h2>
        <p className="muted">
          Service {serviceRunning ? 'running' : 'stopped'} — auto-skip works when players are connected.
        </p>
        {devices.length === 0 ? (
          <p className="muted">No devices found yet.</p>
        ) : (
          <ul className="device-list">
            {devices.map((device) => (
              <li key={device.deviceId} className="device-item">
                <div>
                  <strong>
                    <span className={`status-dot ${device.mqttConnected ? 'online' : 'offline'}`} />
                    {device.name}
                  </strong>
                  <div className="muted">
                    {device.deviceType}
                    {device.description ? ` · ${device.description}` : ''}
                  </div>
                  <div className="muted">
                    {device.online ? 'Online' : 'Offline'}
                    {device.batteryLevel != null ? ` · Battery ${device.batteryLevel}%` : ''}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card">
        <div className="actions" style={{ justifyContent: 'space-between', marginBottom: '1rem' }}>
          <h2 style={{ margin: 0 }}>Skip Profiles</h2>
          <Link to="/cards/new">
            <button type="button">Add card</button>
          </Link>
        </div>

        {profiles.length === 0 ? (
          <p className="muted">No skip profiles yet. Add a card to choose tracks to skip.</p>
        ) : (
          <ul className="profile-list">
            {profiles.map((profile) => (
              <li key={profile.id} className="profile-item">
                <div>
                  <strong>{profile.cardTitle}</strong>
                  <div className="muted">
                    {profile.skipTrackKeys.length} track{profile.skipTrackKeys.length === 1 ? '' : 's'} skipped
                  </div>
                </div>
                <div className="actions">
                  <label className="toggle">
                    <input
                      type="checkbox"
                      checked={profile.enabled}
                      onChange={(event) => void toggleProfile(profile.cardId, event.target.checked)}
                    />
                    Enabled
                  </label>
                  <Link to={`/cards/${profile.cardId}`}>
                    <button className="secondary" type="button">
                      Edit
                    </button>
                  </Link>
                  <button className="danger" type="button" onClick={() => void deleteProfile(profile.cardId)}>
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card">
        <h2>Recent Activity</h2>
        {activity.length === 0 ? (
          <p className="muted">Auto-skips will appear here.</p>
        ) : (
          <ul className="activity-list">
            {activity.slice(0, 10).map((entry) => (
              <li key={entry.id} className="activity-item">
                <div>
                  <strong>{entry.cardTitle}</strong>
                  <div className="muted">
                    Skipped “{entry.skippedTrackTitle}” → “{entry.jumpedToTrackTitle}” on {entry.deviceName}
                  </div>
                  <div className="muted">{new Date(entry.timestamp).toLocaleString()}</div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {error ? <p className="error">{error}</p> : null}
    </>
  )
}
