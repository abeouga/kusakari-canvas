import { SiteHeader } from './SiteHeader';

export function GardenHeader({ title, subtitle = null }) {
    return (<>
      <SiteHeader />
      <header className="canvas-workspace-heading">
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      <span className="version-tag">Garden workspace</span>
    </header></>);
}
