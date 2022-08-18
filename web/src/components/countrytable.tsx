import React, { useMemo, useState } from 'react';
import { connect } from 'react-redux';
import { scaleLinear } from 'd3-scale';
import { max as d3Max, min as d3Min } from 'd3-array';
import { noop } from '../helpers/noop';
import styled from 'styled-components';

import { dispatchApplication } from '../store';
import { useRefWidthHeightObserver } from '../hooks/viewport';
import { useCurrentZoneData, useCurrentZoneExchangeKeys, useCurrentZoneHistory } from '../hooks/redux';
import { useCo2ColorScale } from '../hooks/theme';
import { getTooltipPosition } from '../helpers/graph';
import { modeOrder, modeColor, DEFAULT_FLAG_SIZE } from '../helpers/constants';
import { getElectricityProductionValue, getProductionCo2Intensity, getExchangeCo2Intensity } from '../helpers/zonedata';
import { flagUri } from '../helpers/flags';
import { useTranslation } from '../helpers/translation';

import CountryPanelProductionTooltip from './tooltips/countrypanelproductiontooltip';
import CountryPanelExchangeTooltip from './tooltips/countrypanelexchangetooltip';
import CountryTableOverlayIfNoData from './countrytableoverlayifnodata';

const LABEL_MAX_WIDTH = 102;
const TEXT_ADJUST_Y = 11;
const ROW_HEIGHT = 13;
const PADDING_Y = 7;
const PADDING_X = 5;
const RECT_OPACITY = 0.8;
const X_AXIS_HEIGHT = 15;
const SCALE_TICKS = 4;

const CountryTableSVG = styled.svg`
  width: 100%;
`;

const CountryTableContainer = styled.div`
  width: 100%;
  position: relative;
`;

const getProductionData = (data: any) =>
  modeOrder.map((mode) => {
    const isStorage = mode.indexOf('storage') !== -1;
    const resource = mode.replace(' storage', '');

    // Power in MW
    const capacity = (data.capacity || {})[mode];
    const production = (data.production || {})[resource];
    const storage = (data.storage || {})[resource];

    // Production CO₂ intensity
    const gCo2eqPerkWh = getProductionCo2Intensity(mode, data);
    const gCo2eqPerHour = gCo2eqPerkWh * 1e3 * (isStorage ? storage : production);
    const tCo2eqPerMin = gCo2eqPerHour / 1e6 / 60.0;

    return {
      isStorage,
      storage,
      production,
      capacity,
      mode,
      tCo2eqPerMin,
    };
  });

const getExchangeData = (data: any, exchangeKeys: any, electricityMixMode: any) =>
  exchangeKeys.map((mode: any) => {
    // Power in MW
    const exchange = (data.exchange || {})[mode];
    const exchangeCapacityRange = (data.exchangeCapacities || {})[mode];

    // Exchange CO₂ intensity
    const gCo2eqPerkWh = getExchangeCo2Intensity(mode, data, electricityMixMode);
    const gCo2eqPerHour = gCo2eqPerkWh * 1e3 * exchange;
    const tCo2eqPerMin = gCo2eqPerHour / 1e6 / 60.0;

    return {
      exchange,
      exchangeCapacityRange,
      mode,
      gCo2eqPerkWh,
      tCo2eqPerMin,
    };
  });

const getDataBlockPositions = (productionData: any, exchangeData: any) => {
  const productionHeight = productionData.length * (ROW_HEIGHT + PADDING_Y);
  const productionY = X_AXIS_HEIGHT + PADDING_Y;

  const exchangeFlagX =
    LABEL_MAX_WIDTH - 4.0 * PADDING_X - DEFAULT_FLAG_SIZE - Number(d3Max(exchangeData, (d: any) => d.mode.length)) * 8;
  const exchangeHeight = exchangeData.length * (ROW_HEIGHT + PADDING_Y);
  const exchangeY = productionY + productionHeight + ROW_HEIGHT + PADDING_Y;

  return {
    productionHeight,
    productionY,
    exchangeFlagX,
    exchangeHeight,
    exchangeY,
  };
};

const Axis = ({ formatTick, height, scale }: any) => (
  <g
    className="x axis"
    fill="none"
    fontSize="10"
    fontFamily="sans-serif"
    textAnchor="middle"
    transform={`translate(${scale.range()[0] + LABEL_MAX_WIDTH}, ${X_AXIS_HEIGHT})`}
  >
    <path className="domain" stroke="currentColor" d={`M${scale.range()[0] + 0.5},0.5H${scale.range()[1] + 0.5}`} />
    {scale.ticks(SCALE_TICKS).map((t: any) => (
      <g key={t} className="tick" opacity="1" transform={`translate(${scale(t)}, 0)`}>
        <line stroke="currentColor" y2={height - X_AXIS_HEIGHT} />
        <text fill="currentColor" y="-3" dy="0">
          {formatTick(t)}
        </text>
      </g>
    ))}
  </g>
);

const Row = ({ children, index, isMobile, label, scale, value, onMouseOver, onMouseOut, width }: any) => {
  // Don't render if the width is not positive
  if (width <= 0) {
    return null;
  }

  return (
    <g className="row" transform={`translate(0, ${index * (ROW_HEIGHT + PADDING_Y)})`}>
      {/* Row background */}
      <rect
        y="-1"
        fill="transparent"
        width={width}
        height={ROW_HEIGHT + PADDING_Y}
        /* Support only click events in mobile mode, otherwise react to mouse hovers */
        onClick={isMobile ? onMouseOver : noop}
        onFocus={!isMobile ? onMouseOver : noop}
        onMouseOver={!isMobile ? onMouseOver : noop}
        onMouseMove={!isMobile ? onMouseOver : noop}
        onMouseOut={onMouseOut}
        onBlur={onMouseOut}
      />

      {/* Row label */}
      <text
        className="name"
        style={{ pointerEvents: 'none', textAnchor: 'end' }}
        transform={`translate(${LABEL_MAX_WIDTH - 1.5 * PADDING_Y}, ${TEXT_ADJUST_Y})`}
      >
        {label}
      </text>

      {/* Row content */}
      {children}

      {/* Question mark if the value is not defined */}
      {!Number.isFinite(value) && (
        <text
          className="unknown"
          transform={`translate(3, ${TEXT_ADJUST_Y})`}
          style={{ pointerEvents: 'none', fill: 'darkgray' }}
          x={LABEL_MAX_WIDTH + scale(0)}
        >
          ?
        </text>
      )}
    </g>
  );
};

const HorizontalBar = ({ className, fill, range, scale }: any) => {
  // Don't render if the range is not valid
  if (!Array.isArray(range) || !Number.isFinite(range[0]) || !Number.isFinite(range[1])) {
    return null;
  }

  const x1 = Math.min(range[0], range[1]);
  const x2 = Math.max(range[0], range[1]);
  const width = scale(x2) - scale(x1);

  // Don't render if the width is not positive
  if (width <= 0) {
    return null;
  }

  return (
    <rect
      className={className}
      fill={fill}
      height={ROW_HEIGHT}
      opacity={RECT_OPACITY}
      shapeRendering="crispEdges"
      style={{ pointerEvents: 'none' }}
      x={LABEL_MAX_WIDTH + scale(x1)}
      width={width}
    />
  );
};
interface TableProps {
  data: any;
  exchangeData: any;
  height: any;
  isMobile: any;
  productionData: any;
  onProductionRowMouseOver: any;
  onProductionRowMouseOut: any;
  onExchangeRowMouseOver: any;
  onExchangeRowMouseOut: any;
  width: any;
}
const CountryCarbonEmissionsTable = React.memo(
  ({
    data,
    exchangeData,
    height,
    isMobile,
    productionData,
    onProductionRowMouseOver,
    onProductionRowMouseOut,
    onExchangeRowMouseOver,
    onExchangeRowMouseOut,
    width,
  }: TableProps) => {
    const { __ } = useTranslation();
    const { productionY, exchangeFlagX, exchangeY } = getDataBlockPositions(productionData, exchangeData);

    const maxCO2eqExport = d3Max(exchangeData, (d: any) => Math.max(0, -d.tCo2eqPerMin)) || 0;
    const maxCO2eqImport = d3Max(exchangeData, (d: any) => Math.max(0, d.tCo2eqPerMin)) || 0;
    const maxCO2eqProduction = d3Max(productionData, (d: any) => Number(d.tCo2eqPerMin)) || 0;

    // in tCO₂eq/min
    const co2Scale = useMemo(
      () =>
        scaleLinear()
          .domain([-maxCO2eqExport, Math.max(maxCO2eqProduction, maxCO2eqImport)])
          .range([0, width - LABEL_MAX_WIDTH - PADDING_X]),
      [maxCO2eqExport, maxCO2eqProduction, maxCO2eqImport, width]
    );

    const formatTick = (t: any) => {
      const [x1, x2] = co2Scale.domain();
      if (x2 - x1 <= 1) {
        return `${t * 1e3} kg/min`;
      }
      return `${t} t/min`;
    };

    return (
      <CountryTableSVG height={height} style={{ overflow: 'visible' }}>
        <Axis formatTick={formatTick} height={height} scale={co2Scale} />
        <g transform={`translate(0, ${productionY})`}>
          {productionData.map((d: any, index: any) => (
            <Row
              key={d.mode}
              index={index}
              label={__(d.mode)}
              width={width}
              scale={co2Scale}
              value={Math.abs(d.tCo2eqPerMin)}
              onMouseOver={(ev: any) => onProductionRowMouseOver(d.mode, data, ev)}
              onMouseOut={onProductionRowMouseOut}
              isMobile={isMobile}
            >
              <HorizontalBar
                className="production"
                // @ts-expect-error TS(7053): Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
                fill={modeColor[d.mode]}
                range={[0, Math.abs(d.tCo2eqPerMin)]}
                scale={co2Scale}
              />
            </Row>
          ))}
        </g>
        <g transform={`translate(0, ${exchangeY})`}>
          {exchangeData.map((d: any, index: any) => (
            <Row
              key={d.mode}
              index={index}
              label={d.mode}
              width={width}
              scale={co2Scale}
              value={d.tCo2eqPerMin}
              onMouseOver={(ev: any) => onExchangeRowMouseOver(d.mode, data, ev)}
              onMouseOut={onExchangeRowMouseOut}
              isMobile={isMobile}
            >
              <image style={{ pointerEvents: 'none' }} x={exchangeFlagX} xlinkHref={flagUri(d.mode)} />
              <HorizontalBar className="exchange" fill="gray" range={[0, d.tCo2eqPerMin]} scale={co2Scale} />
            </Row>
          ))}
        </g>
      </CountryTableSVG>
    );
  }
);

const CountryElectricityProductionTable = React.memo(
  ({
    data,
    exchangeData,
    height,
    isMobile,
    productionData,
    onProductionRowMouseOver,
    onProductionRowMouseOut,
    onExchangeRowMouseOver,
    onExchangeRowMouseOut,
    width,
  }: TableProps) => {
    const { __ } = useTranslation();
    const co2ColorScale = useCo2ColorScale();

    const { productionY, exchangeFlagX, exchangeY } = getDataBlockPositions(productionData, exchangeData);

    // Use the whole history to determine the min/max,
    // fallback on current data
    const history = useCurrentZoneHistory();
    const [minPower, maxPower] = useMemo(() => {
      const historyOrCurrent = history && history.length ? history : [data];
      return [
        Number(
          d3Min(
            historyOrCurrent.map((zoneData: any) =>
              Math.min(
                -zoneData.maxStorageCapacity || 0,
                -zoneData.maxStorage || 0,
                -zoneData.maxExport || 0,
                -zoneData.maxExportCapacity || 0
              )
            )
          )
        ) || 0,
        Number(
          d3Max(
            historyOrCurrent.map((zoneData: any) =>
              Math.max(
                zoneData.maxCapacity || 0,
                zoneData.maxProduction || 0,
                zoneData.maxDischarge || 0,
                zoneData.maxStorageCapacity || 0,
                zoneData.maxImport || 0,
                zoneData.maxImportCapacity || 0
              )
            )
          )
        ) || 0,
      ];
    }, [history, data]);

    // Power in MW
    const powerScale = scaleLinear()
      .domain([minPower, maxPower])
      .range([0, width - LABEL_MAX_WIDTH - PADDING_X]);

    const formatTick = (t: any) => {
      const [x1, x2] = powerScale.domain();
      if (x2 - x1 <= 1) {
        return `${t * 1e3} kW`;
      }
      if (x2 - x1 <= 1e3) {
        return `${t} MW`;
      }
      return `${t * 1e-3} GW`;
    };

    return (
      <CountryTableSVG height={height} style={{ overflow: 'visible' }}>
        <Axis formatTick={formatTick} height={height} scale={powerScale} />
        <g transform={`translate(0, ${productionY})`}>
          {productionData.map((d: any, index: any) => (
            <Row
              key={d.mode}
              index={index}
              label={__(d.mode)}
              width={width}
              scale={powerScale}
              value={getElectricityProductionValue(d)}
              onMouseOver={(ev: any) => onProductionRowMouseOver(d.mode, data, ev)}
              onMouseOut={onProductionRowMouseOut}
              isMobile={isMobile}
            >
              <HorizontalBar
                className="capacity"
                fill="rgba(0, 0, 0, 0.15)"
                range={d.isStorage ? [-d.capacity, d.capacity] : [0, d.capacity]}
                scale={powerScale}
              />
              <HorizontalBar
                className="production"
                // @ts-expect-error TS(7053): Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
                fill={modeColor[d.mode]}
                range={[0, getElectricityProductionValue(d)]}
                scale={powerScale}
              />
            </Row>
          ))}
        </g>
        <g transform={`translate(0, ${exchangeY})`}>
          {exchangeData.map((d: any, index: any) => (
            <Row
              key={d.mode}
              index={index}
              label={d.mode}
              width={width}
              scale={powerScale}
              value={d.exchange}
              onMouseOver={(ev: any) => onExchangeRowMouseOver(d.mode, data, ev)}
              onMouseOut={onExchangeRowMouseOut}
              isMobile={isMobile}
            >
              <image style={{ pointerEvents: 'none' }} x={exchangeFlagX} xlinkHref={flagUri(d.mode)} />
              <HorizontalBar
                className="capacity"
                fill="rgba(0, 0, 0, 0.15)"
                range={d.exchangeCapacityRange}
                scale={powerScale}
              />
              <HorizontalBar
                className="exchange"
                fill={co2ColorScale(d.gCo2eqPerkWh)}
                range={[0, d.exchange]}
                scale={powerScale}
              />
            </Row>
          ))}
        </g>
      </CountryTableSVG>
    );
  }
);

const mapStateToProps = (state: any) => ({
  displayByEmissions: state.application.tableDisplayEmissions,
  electricityMixMode: state.application.electricityMixMode,
  isMobile: state.application.isMobile,
});

const CountryTable = ({ displayByEmissions, electricityMixMode, isMobile }: any) => {
  const { ref, width } = useRefWidthHeightObserver();

  const exchangeKeys = useCurrentZoneExchangeKeys();
  const data = useCurrentZoneData();

  const productionData = useMemo(() => getProductionData(data), [data]);
  const exchangeData = useMemo(
    () => getExchangeData(data, exchangeKeys, electricityMixMode),
    [data, exchangeKeys, electricityMixMode]
  );

  const [productionTooltip, setProductionTooltip] = useState(null);
  const [exchangeTooltip, setExchangeTooltip] = useState(null);

  const handleProductionRowMouseOver = (mode: any, zoneData: any, ev: any) => {
    dispatchApplication('co2ColorbarValue', getProductionCo2Intensity(mode, zoneData));
    // @ts-expect-error TS(2345): Argument of type '{ mode: any; zoneData: any; posi... Remove this comment to see the full error message
    setProductionTooltip({ mode, zoneData, position: getTooltipPosition(isMobile, { x: ev.clientX, y: ev.clientY }) });
  };

  const handleProductionRowMouseOut = () => {
    dispatchApplication('co2ColorbarValue', null);
    setProductionTooltip(null);
  };

  const handleExchangeRowMouseOver = (mode: any, zoneData: any, ev: any) => {
    dispatchApplication('co2ColorbarValue', getExchangeCo2Intensity(mode, zoneData, electricityMixMode));
    // @ts-expect-error TS(2345): Argument of type '{ mode: any; zoneData: any; posi... Remove this comment to see the full error message
    setExchangeTooltip({ mode, zoneData, position: getTooltipPosition(isMobile, { x: ev.clientX, y: ev.clientY }) });
  };

  const handleExchangeRowMouseOut = () => {
    dispatchApplication('co2ColorbarValue', null);
    setExchangeTooltip(null);
  };

  const { exchangeY, exchangeHeight } = getDataBlockPositions(productionData, exchangeData);
  const height = exchangeY + exchangeHeight;

  return (
    <CountryTableContainer ref={ref}>
      {displayByEmissions ? (
        <CountryCarbonEmissionsTable
          data={data}
          productionData={productionData}
          exchangeData={exchangeData}
          onProductionRowMouseOver={handleProductionRowMouseOver}
          onProductionRowMouseOut={handleProductionRowMouseOut}
          onExchangeRowMouseOver={handleExchangeRowMouseOver}
          onExchangeRowMouseOut={handleExchangeRowMouseOut}
          width={width}
          height={height}
          isMobile={isMobile}
        />
      ) : (
        <CountryElectricityProductionTable
          data={data}
          productionData={productionData}
          exchangeData={exchangeData}
          onProductionRowMouseOver={handleProductionRowMouseOver}
          onProductionRowMouseOut={handleProductionRowMouseOut}
          onExchangeRowMouseOver={handleExchangeRowMouseOver}
          onExchangeRowMouseOut={handleExchangeRowMouseOut}
          width={width}
          height={height}
          isMobile={isMobile}
        />
      )}
      {productionTooltip && (
        <CountryPanelProductionTooltip
          mode={(productionTooltip as any).mode}
          position={(productionTooltip as any).position}
          zoneData={(productionTooltip as any).zoneData}
          onClose={() => setProductionTooltip(null)}
        />
      )}
      {exchangeTooltip && (
        <CountryPanelExchangeTooltip
          exchangeKey={(exchangeTooltip as any).mode}
          position={(exchangeTooltip as any).position}
          zoneData={(exchangeTooltip as any).zoneData}
          onClose={() => setExchangeTooltip(null)}
        />
      )}
      <CountryTableOverlayIfNoData />
    </CountryTableContainer>
  );
};

export default connect(mapStateToProps)(CountryTable);