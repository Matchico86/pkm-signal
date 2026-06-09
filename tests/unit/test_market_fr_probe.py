import pytest
import os
import json
from unittest import mock
from analysis.market_fr_probe import main

@pytest.fixture
def mock_clients():
    with mock.patch("analysis.market_fr_probe.CardmarketApiTcgClient") as mock_price_client, \
         mock.patch("analysis.market_fr_probe.SerpapiTrendsClient") as mock_trend_client:
        
        # Default successful returns
        mock_price_client.return_value.fetch_price.return_value = {
            "usable_for_signal": True,
            "warnings": []
        }
        mock_trend_client.return_value.fetch_trends.return_value = {
            "usable_for_signal": True,
            "warnings": []
        }
        yield mock_price_client, mock_trend_client

@pytest.fixture
def mock_output():
    with mock.patch("builtins.open", mock.mock_open()) as m_open:
        with mock.patch("os.makedirs"):
            yield m_open

def _get_written_json(mock_file) -> dict:
    # Helper to reconstruct the JSON string passed to the mock_open write method
    written_content = "".join(call.args[0] for call in mock_file().write.call_args_list)
    return json.loads(written_content)

@mock.patch("sys.argv", ["market_fr_probe.py", "--query", "Test"])
def test_without_live_forces_env_false(mock_clients, mock_output):
    # Setup initial env as true to prove it gets forced to false
    with mock.patch.dict(os.environ, {"RAPIDAPI_LIVE_CALLS_ENABLED": "true", "SERPAPI_LIVE_CALLS_ENABLED": "true"}):
        main()
        assert os.environ["RAPIDAPI_LIVE_CALLS_ENABLED"] == "false"
        assert os.environ["SERPAPI_LIVE_CALLS_ENABLED"] == "false"

@mock.patch("sys.argv", ["market_fr_probe.py", "--query", "Test", "--live"])
def test_with_live_keeps_env_intact(mock_clients, mock_output):
    # Setup initial env as false to prove --live does NOT force them to true
    with mock.patch.dict(os.environ, {"RAPIDAPI_LIVE_CALLS_ENABLED": "false", "SERPAPI_LIVE_CALLS_ENABLED": "false"}):
        main()
        assert os.environ["RAPIDAPI_LIVE_CALLS_ENABLED"] == "false"
        assert os.environ["SERPAPI_LIVE_CALLS_ENABLED"] == "false"

@mock.patch("sys.argv", ["market_fr_probe.py", "--query", "Test", "--source", "price"])
def test_source_price_only(mock_clients, mock_output):
    price_cls, trend_cls = mock_clients
    main()
    price_cls.return_value.fetch_price.assert_called_once_with("Test")
    trend_cls.return_value.fetch_trends.assert_not_called()

@mock.patch("sys.argv", ["market_fr_probe.py", "--query", "Test", "--source", "trends"])
def test_source_trends_only(mock_clients, mock_output):
    price_cls, trend_cls = mock_clients
    main()
    price_cls.return_value.fetch_price.assert_not_called()
    trend_cls.return_value.fetch_trends.assert_called_once_with("Test")

@mock.patch("sys.argv", ["market_fr_probe.py", "--query", "Test", "--source", "both"])
def test_source_both(mock_clients, mock_output):
    price_cls, trend_cls = mock_clients
    main()
    price_cls.return_value.fetch_price.assert_called_once_with("Test")
    trend_cls.return_value.fetch_trends.assert_called_once_with("Test")

@mock.patch("sys.argv", ["market_fr_probe.py", "--query", "Test", "--source", "both"])
def test_usable_for_signal_logic(mock_clients, mock_output):
    price_cls, trend_cls = mock_clients
    
    # 1. Both valid -> usable_for_signal is True
    main()
    data = _get_written_json(mock_output)
    assert data["usable_for_signal"] is True
    
    # 2. Price fails/non-FR strict -> usable_for_signal is False
    price_cls.return_value.fetch_price.return_value = {"usable_for_signal": False, "warnings": ["w"]}
    mock_output().write.reset_mock()
    main()
    data = _get_written_json(mock_output)
    assert data["usable_for_signal"] is False
    
    # 3. Both fail -> usable_for_signal is False
    trend_cls.return_value.fetch_trends.return_value = {"usable_for_signal": False, "warnings": ["w"]}
    mock_output().write.reset_mock()
    main()
    data = _get_written_json(mock_output)
    assert data["usable_for_signal"] is False

@mock.patch("sys.argv", ["market_fr_probe.py", "--query", "Test", "--source", "price"])
def test_usable_for_signal_absent_source_ignored(mock_clients, mock_output):
    price_cls, trend_cls = mock_clients
    # Trends is mocked to fail, BUT we didn't ask for it
    trend_cls.return_value.fetch_trends.return_value = {"usable_for_signal": False}
    
    main()
    data = _get_written_json(mock_output)
    
    # Final result should be True because the requested source (price) is True
    assert data["usable_for_signal"] is True
    # The trend output should be empty because it wasn't requested
    assert data["trend_snapshot"] == {}
