// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract CubeEscrow {
    enum TaskState {
        Open,
        Assigned,
        Submitted,
        Paid,
        Cancelled
    }

    struct TaskEscrow {
        address poster;
        address winner;
        uint256 reward;
        uint256 fee;
        TaskState state;
    }

    struct BidStake {
        uint256 amount;
        bool refunded;
        bool slashed;
    }

    address public immutable treasury;
    uint256 public immutable feeBps;
    uint256 public taskCount;

    mapping(uint256 => TaskEscrow) public tasks;
    mapping(uint256 => mapping(address => BidStake)) public bidStakes;

    event TaskCreated(uint256 indexed taskId, address indexed poster, uint256 reward, uint256 fee);
    event BidStaked(uint256 indexed taskId, address indexed agent, uint256 amount);
    event WinnerSelected(uint256 indexed taskId, address indexed agent);
    event TaskSubmitted(uint256 indexed taskId, address indexed agent);
    event PayoutReleased(uint256 indexed taskId, address indexed winner, uint256 reward, uint256 fee);
    event StakeRefunded(uint256 indexed taskId, address indexed agent, uint256 amount);
    event StakeSlashed(uint256 indexed taskId, address indexed agent, uint256 amount);

    error InvalidAmount();
    error InvalidState();
    error Unauthorized();
    error NoStake();
    constructor(address treasury_, uint256 feeBps_) {
        if (treasury_ == address(0) || feeBps_ > 10_000) {
            revert InvalidAmount();
        }

        treasury = treasury_;
        feeBps = feeBps_;
    }

    function createTask() external payable returns (uint256 taskId) {
        if (msg.value == 0) {
            revert InvalidAmount();
        }

        taskId = ++taskCount;
        uint256 fee = (msg.value * feeBps) / 10_000;
        uint256 reward = msg.value - fee;

        tasks[taskId] = TaskEscrow({
            poster: msg.sender,
            winner: address(0),
            reward: reward,
            fee: fee,
            state: TaskState.Open
        });

        emit TaskCreated(taskId, msg.sender, reward, fee);
    }

    function stakeBid(uint256 taskId) external payable {
        TaskEscrow storage task = tasks[taskId];

        if (task.poster == address(0) || task.state != TaskState.Open) {
            revert InvalidState();
        }

        if (msg.value == 0) {
            revert InvalidAmount();
        }

        BidStake storage bid = bidStakes[taskId][msg.sender];
        bid.amount += msg.value;
        bid.refunded = false;
        bid.slashed = false;

        emit BidStaked(taskId, msg.sender, msg.value);
    }

    function selectWinner(uint256 taskId, address winner) external {
        TaskEscrow storage task = tasks[taskId];

        if (msg.sender != task.poster || task.state != TaskState.Open || winner == address(0)) {
            revert Unauthorized();
        }

        task.winner = winner;
        task.state = TaskState.Assigned;

        emit WinnerSelected(taskId, winner);
    }

    function submitTask(uint256 taskId) external {
        TaskEscrow storage task = tasks[taskId];

        if (msg.sender != task.winner || task.state != TaskState.Assigned) {
            revert Unauthorized();
        }

        task.state = TaskState.Submitted;

        emit TaskSubmitted(taskId, msg.sender);
    }

    function releasePayout(uint256 taskId) external {
        TaskEscrow storage task = tasks[taskId];

        if (msg.sender != task.poster || task.state != TaskState.Submitted) {
            revert Unauthorized();
        }

        task.state = TaskState.Paid;

        (bool winnerPaid, ) = payable(task.winner).call{value: task.reward}("");
        (bool treasuryPaid, ) = payable(treasury).call{value: task.fee}("");

        if (!winnerPaid || !treasuryPaid) {
            revert InvalidState();
        }

        emit PayoutReleased(taskId, task.winner, task.reward, task.fee);
    }

    function refundBidStake(uint256 taskId, address agent) external {
        TaskEscrow storage task = tasks[taskId];
        BidStake storage bid = bidStakes[taskId][agent];

        if (msg.sender != task.poster || task.state == TaskState.Open) {
            revert Unauthorized();
        }

        if (bid.amount == 0 || bid.refunded || bid.slashed) {
            revert NoStake();
        }

        bid.refunded = true;

        (bool paid, ) = payable(agent).call{value: bid.amount}("");

        if (!paid) {
            revert InvalidState();
        }

        emit StakeRefunded(taskId, agent, bid.amount);
    }

    function slashBidStake(uint256 taskId, address agent) external {
        TaskEscrow storage task = tasks[taskId];
        BidStake storage bid = bidStakes[taskId][agent];

        if (msg.sender != task.poster || task.state == TaskState.Open) {
            revert Unauthorized();
        }

        if (bid.amount == 0 || bid.refunded || bid.slashed) {
            revert NoStake();
        }

        bid.slashed = true;

        (bool paid, ) = payable(treasury).call{value: bid.amount}("");

        if (!paid) {
            revert InvalidState();
        }

        emit StakeSlashed(taskId, agent, bid.amount);
    }
}
