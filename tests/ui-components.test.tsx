import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { VolunteerProvider } from '../src/context/VolunteerContext';
import { StatusBadge } from '../src/components/StatusBadge';
import { Header } from '../src/components/Header';
import { VolunteerControls } from '../src/components/VolunteerControls';
import { OverviewSection } from '../src/components/OverviewSection';

describe('AWARESPAN Volunteer Portal — UI Components Suite', () => {
  it('renders StatusBadge with correct styles and text for all states', () => {
    const { rerender } = render(<StatusBadge state="NOT_CONNECTED" />);
    expect(screen.getByText('IDLE / DISCONNECTED')).toBeInTheDocument();

    rerender(<StatusBadge state="CONNECTING" />);
    expect(screen.getByText('CONNECTING TO PI...')).toBeInTheDocument();

    rerender(<StatusBadge state="CAMERA_CONNECTED" />);
    expect(screen.getByText('CAMERA ACTIVE (PI ACK)')).toBeInTheDocument();

    rerender(<StatusBadge state="MICROPHONE_CONNECTED" />);
    expect(screen.getByText('MIC ACTIVE (PI ACK)')).toBeInTheDocument();

    rerender(<StatusBadge state="BOTH_CONNECTED" />);
    expect(screen.getByText('BOTH SOURCES ACTIVE')).toBeInTheDocument();

    rerender(<StatusBadge state="PERMISSION_DENIED" />);
    expect(screen.getByText('PERMISSION DENIED')).toBeInTheDocument();
  });

  it('renders Header with AWARESPAN wordmark and action buttons', () => {
    const onOpenAuth = vi.fn();
    const onOpenConfig = vi.fn();
    const onOpenDocs = vi.fn();

    render(
      <VolunteerProvider>
        <Header
          onOpenAuth={onOpenAuth}
          onOpenConfig={onOpenConfig}
          onOpenDocs={onOpenDocs}
        />
      </VolunteerProvider>
    );

    expect(screen.getByText('AWARESPAN')).toBeInTheDocument();
    expect(screen.getByText('AUTHENTICATE')).toBeInTheDocument();

    fireEvent.click(screen.getByText('AUTHENTICATE'));
    expect(onOpenAuth).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText('CONTRACT'));
    expect(onOpenDocs).toHaveBeenCalledTimes(1);
  });

  it('renders VolunteerControls with 3 segmented mode buttons', () => {
    render(
      <VolunteerProvider>
        <VolunteerControls onOpenAuthPrompt={vi.fn()} />
      </VolunteerProvider>
    );

    expect(screen.getByText('01 // Camera')).toBeInTheDocument();
    expect(screen.getByText('02 // Microphone')).toBeInTheDocument();
    expect(screen.getByText('03 // Both Sources')).toBeInTheDocument();
    expect(screen.getByText('START VOLUNTEERING NOW')).toBeInTheDocument();

    // Switch mode
    fireEvent.click(screen.getByText('02 // Microphone'));
    expect(screen.getByText('Target Microphone')).toBeInTheDocument();
  });

  it('renders OverviewSection with node ID and target URL', () => {
    render(
      <VolunteerProvider>
        <OverviewSection />
      </VolunteerProvider>
    );

    expect(screen.getByText('TARGET RASPBERRY PI EDGE NODE')).toBeInTheDocument();
    expect(screen.getByText('Probe Node Health')).toBeInTheDocument();
    expect(screen.getByText('NODE STATUS')).toBeInTheDocument();
  });
});
