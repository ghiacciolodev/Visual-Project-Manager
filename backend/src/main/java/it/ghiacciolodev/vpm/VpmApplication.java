package it.ghiacciolodev.vpm;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.ConfigurationPropertiesScan;

@SpringBootApplication
@ConfigurationPropertiesScan
public class VpmApplication {

	public static void main(String[] args) {
		SpringApplication.run(VpmApplication.class, args);
	}

}
