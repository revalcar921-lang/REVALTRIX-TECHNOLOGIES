import { useEffect, useRef, useState } from 'react';
import './AppointmentDiscoveryMap.css';

export interface AppointmentMapLocation {
  tenantId: string;
  branchId: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
}

interface GoogleMapsApi {
  Map: new (element: HTMLElement, options: Record<string, unknown>) => {
    fitBounds(bounds: unknown): void;
    setCenter(position: { lat: number; lng: number }): void;
    setZoom(zoom: number): void;
  };
  Marker: new (options: Record<string, unknown>) => {
    addListener(event: string, callback: () => void): void;
  };
  LatLngBounds: new () => { extend(position: { lat: number; lng: number }): void };
}

declare global {
  interface Window {
    google?: { maps: GoogleMapsApi };
  }
}

let mapsScriptPromise: Promise<GoogleMapsApi | null> | null = null;

function loadGoogleMaps(apiKey: string): Promise<GoogleMapsApi | null> {
  if (window.google?.maps) return Promise.resolve(window.google.maps);
  if (mapsScriptPromise) return mapsScriptPromise;

  mapsScriptPromise = new Promise((resolve) => {
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&v=weekly`;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve(window.google?.maps ?? null);
    script.onerror = () => resolve(null);
    document.head.append(script);
  });
  return mapsScriptPromise;
}

export function AppointmentDiscoveryMap({
  locations,
  selectedTenantId,
  onSelectTenant,
}: {
  locations: AppointmentMapLocation[];
  selectedTenantId: string;
  onSelectTenant: (tenantId: string) => void;
}) {
  const mapElement = useRef<HTMLDivElement>(null);
  const [mapUnavailable, setMapUnavailable] = useState(false);

  useEffect(() => {
    const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY?.trim();
    if (!apiKey || locations.length === 0 || !mapElement.current) {
      setMapUnavailable(!apiKey);
      return;
    }

    let cancelled = false;
    void loadGoogleMaps(apiKey).then((maps) => {
      if (cancelled) return;
      if (!maps || !mapElement.current) {
        setMapUnavailable(true);
        return;
      }
      setMapUnavailable(false);
      const map = new maps.Map(mapElement.current, {
        center: { lat: locations[0]!.latitude, lng: locations[0]!.longitude },
        zoom: locations.length === 1 ? 13 : 6,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: true,
      });
      const bounds = new maps.LatLngBounds();
      for (const location of locations) {
        const position = { lat: location.latitude, lng: location.longitude };
        bounds.extend(position);
        const marker = new maps.Marker({
          map,
          position,
          title: `${location.name}, ${location.address}`,
          ...(location.tenantId === selectedTenantId ? { zIndex: 2 } : {}),
        });
        marker.addListener('click', () => onSelectTenant(location.tenantId));
      }
      if (locations.length > 1) map.fitBounds(bounds);
      else map.setCenter({ lat: locations[0]!.latitude, lng: locations[0]!.longitude });
    });

    return () => { cancelled = true; };
  }, [locations, onSelectTenant, selectedTenantId]);

  if (locations.length === 0) {
    return <p className="appointment-map-empty">No verified branch coordinates are available for these results.</p>;
  }

  return (
    <div className="appointment-map-frame">
      <div ref={mapElement} className="appointment-discovery-map" aria-label="Map of bookable facility branches" />
      {mapUnavailable ? <p className="appointment-map-notice">Map unavailable. Browse the location results below or configure a browser-restricted Google Maps key.</p> : null}
    </div>
  );
}