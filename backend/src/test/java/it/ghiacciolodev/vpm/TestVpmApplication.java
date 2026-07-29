package it.ghiacciolodev.vpm;

import org.springframework.boot.SpringApplication;

public class TestVpmApplication {

	public static void main(String[] args) {
		SpringApplication.from(VpmApplication::main).with(TestcontainersConfiguration.class).run(args);
	}

}
