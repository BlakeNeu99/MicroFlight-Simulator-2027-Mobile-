import { FlightModel } from '../engine/physics/FlightModel';
import { WeatherField } from '../engine/physics/Atmosphere';

export class AircraftEntity {
  flight: FlightModel;
  weather: WeatherField;
  constructor(weather:WeatherField){
    this.weather=weather;
    this.flight=new FlightModel(weather);
  }
  update(dt:number){
    this.flight.step(dt);
    this.weather.update(dt, this.flight.pos.y);
  }
  get pos(){ return this.flight.pos; }
  get vel(){ return this.flight.vel; }
  get quat(){ return this.flight.quat; }
}
