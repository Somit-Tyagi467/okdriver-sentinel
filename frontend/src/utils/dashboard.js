import { Bell, Camera, Eye, FileClock, LayoutDashboard, MapPinned, Shield } from "lucide-react";
export const centers = [{
  id: "all",
  name: "All Command Centers",
  state: "Multi-state",
  coords: [23.5, 72]
}, {
  id: "ahmedabad",
  name: "Ahmedabad",
  state: "Gujarat",
  coords: [23.0225, 72.5714]
}, {
  id: "surat",
  name: "Surat",
  state: "Gujarat",
  coords: [21.1702, 72.8311]
}, {
  id: "vadodara",
  name: "Vadodara",
  state: "Gujarat",
  coords: [22.3072, 73.1812]
}, {
  id: "rajkot",
  name: "Rajkot",
  state: "Gujarat",
  coords: [22.3039, 70.8022]
}, {
  id: "gandhinagar",
  name: "Gandhinagar",
  state: "Gujarat",
  coords: [23.2156, 72.6369]
}, {
  id: "jaipur",
  name: "Jaipur",
  state: "Rajasthan",
  coords: [26.9124, 75.7873]
}, {
  id: "mumbai",
  name: "Mumbai",
  state: "Maharashtra",
  coords: [19.076, 72.8777]
}, {
  id: "bhopal",
  name: "Bhopal",
  state: "Madhya Pradesh",
  coords: [23.2599, 77.4126]
}];
export const navigationItems = [["Overview", LayoutDashboard], ["Camera Registry", Camera], ["Detection History", Eye], ["Vehicle Tracking", MapPinned], ["Alert Center", Bell], ["Watchlist", Shield], ["Audit Log", FileClock]];
export const cx = (...classes) => classes.filter(Boolean).join(" ");
export const fmt = value => value ? new Date(value).toLocaleString() : "—";
export const vehicleOf = record => record.vehicle_number || record.identifier || "Unknown";
